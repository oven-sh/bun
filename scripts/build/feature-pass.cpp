// Puts what is compiled for a feature where `bun build --compile
// --compile-exclude-features` can find it and leave it out
// (src/bun_core/feature.rs says what a feature is, src/exe_features leaves it
// out).
//
// An LLVM pass, as a plugin, because that is what every compiler bun is built
// with has in common:
//
//   BUN_FEATURES=2,3 rustc -Zllvm-plugins=<this>
//   clang -Xclang -load -Xclang <this> -fpass-plugin=<this> -mllvm
//   -bun-features=2,3
//
// rustc reads its options before it loads a plugin. ccache knows nothing of the
// environment.
//
// The numbers are the features that need the compilation unit. The whole unit
// is theirs: nothing that stays depends on it, so nothing that stays can refer
// to what it alone defines.
//
// Its functions go to one section and its constants to another, each between
// two marks, and a record says where the marks are and whose they are. A linker
// keeps what one object has in a section together, so what is between the marks
// is this unit's. There are as many records as there are units, and a record is
// as long as its features are many: nothing here is counted in the headers of
// the executable, which have room for few sections.

#include "llvm/IR/Constants.h"
#include "llvm/IR/IRBuilder.h"
#include "llvm/IR/Instructions.h"
#include "llvm/IR/Module.h"
#include "llvm/Passes/PassBuilder.h"
#include "llvm/Plugins/PassPlugin.h"
#include "llvm/Support/CommandLine.h"
#include "llvm/TargetParser/Triple.h"
#include "llvm/Transforms/Utils/ModuleUtils.h"
#include <cstdlib>

using namespace llvm;

namespace {

cl::opt<std::string>
    featuresOption("bun-features",
                   cl::desc("The features that need this compilation unit"));

// What goes with the features. Not all of it is where it can be left out.
using Owned = SmallPtrSet<const GlobalObject *, 32>;

// What the linker may replace by the copy of another unit is not this unit's
// alone: a C++ template, an inline function.
bool isThisUnitsAlone(const GlobalObject &global) {
  return !global.isDeclaration() && !global.hasAvailableExternallyLinkage() &&
         !global.isWeakForLinker() && !global.hasLinkOnceLinkage() &&
         !global.hasSection();
}

bool isUsedOnlyBy(const Owned &owned, const Value &value,
                  SmallPtrSetImpl<const Value *> &seen) {
  for (const User *user : value.users()) {
    if (!seen.insert(user).second)
      continue;
    if (auto *instruction = dyn_cast<Instruction>(user)) {
      if (!owned.count(instruction->getFunction()))
        return false;
    } else if (auto *global = dyn_cast<GlobalObject>(user)) {
      if (!owned.count(global))
        return false;
    } else if (!isa<Constant>(user) || !isUsedOnlyBy(owned, *user, seen)) {
      return false;
    }
  }
  return true;
}

// What runs before main.
const GlobalVariable *constructorsOf(const Module &module) {
  auto *constructors = module.getNamedGlobal("llvm.global_ctors");
  bool hasAny = constructors && constructors->hasInitializer() &&
                !constructors->getInitializer()->isNullValue();
  return hasAny ? constructors : nullptr;
}

// Before anything else, when they are what the source has: they would run in an
// executable that no longer has them.
struct NoConstructors : PassInfoMixin<NoConstructors> {
  PreservedAnalyses run(Module &module, ModuleAnalysisManager &) {
    if (constructorsOf(module))
      report_fatal_error("a feature cannot have code that runs before main: " +
                         Twine(module.getName()));
    return PreservedAnalyses::all();
  }

  static bool isRequired() { return true; }
};

// A sanitizer puts room around a variable, and these are read one after the
// other.
void keepAsItIs(GlobalVariable *variable) {
  GlobalValue::SanitizerMetadata metadata;
  metadata.NoAddress = metadata.NoHWAddress = true;
  variable->setSanitizerMetadata(metadata);
}

struct FeaturePass : PassInfoMixin<FeaturePass> {
  // "2,3"
  std::string features;

  // {where `begin` is, where `end` is, how many features, the features}. The
  // first two are distances from the record.
  void record(Module &module, StringRef section, GlobalObject *begin,
              GlobalObject *end) {
    LLVMContext &context = module.getContext();
    auto *word = Type::getInt32Ty(context);
    auto *address = Type::getInt64Ty(context);
    SmallVector<StringRef, 4> numbers;
    StringRef(features).split(numbers, ',');

    auto *type = ArrayType::get(word, 3 + numbers.size());
    auto *record =
        new GlobalVariable(module, type, true, GlobalValue::InternalLinkage,
                           nullptr, "bun_feature_part");
    auto distanceTo = [&](GlobalObject *mark) {
      auto *distance =
          ConstantExpr::getSub(ConstantExpr::getPtrToInt(mark, address),
                               ConstantExpr::getPtrToInt(record, address));
      return ConstantExpr::getTrunc(distance, word);
    };
    SmallVector<Constant *, 8> words{distanceTo(begin), distanceTo(end),
                                     ConstantInt::get(word, numbers.size())};
    for (StringRef number : numbers) {
      unsigned feature;
      if (number.getAsInteger(10, feature))
        report_fatal_error("BUN_FEATURES is not a list of numbers");
      words.push_back(ConstantInt::get(word, feature));
    }
    record->setInitializer(ConstantArray::get(type, words));
    record->setSection(section);
    record->setAlignment(Align(4));
    keepAsItIs(record);
    appendToUsed(module, {record});
  }

  PreservedAnalyses run(Module &module, ModuleAnalysisManager &) {
    // src/exe_features/lib.rs has the name of the records. What is after the
    // "." and the "$" only has the linker put what the same features need side
    // by side, which Mach-O has no way to ask for. There the linker folds what
    // is identical in a section of nothing but instructions, also a function of
    // one feature into that of another.
    const Triple &target = module.getTargetTriple();
    std::string key = features;
    std::replace(key.begin(), key.end(), ',', '.');
    bool isMachO = target.isOSBinFormatMachO(),
         isCOFF = target.isOSBinFormatCOFF();
    std::string code = isMachO  ? "__TEXT,__bun_feat_x"
                       : isCOFF ? ".bunfx$" + key
                                : ".bun_feature_x." + key;
    std::string constants = isMachO  ? "__TEXT,__bun_feat_r"
                            : isCOFF ? ".bunfr$" + key
                                     : ".bun_feature_r." + key;
    StringRef records = isMachO  ? "__TEXT,__bun_feat_part"
                        : isCOFF ? ".bunfprt"
                                 : ".bun_feature_parts";

    // Those that there are by now are the compiler's, a sanitizer's for one,
    // and stay.
    SmallPtrSet<const Value *, 4> runBeforeMain;
    if (auto *constructors = constructorsOf(module)) {
      for (const Use &entry :
           cast<ConstantArray>(constructors->getInitializer())->operands())
        runBeforeMain.insert(
            cast<ConstantStruct>(entry)->getOperand(1)->stripPointerCasts());
    }

    Owned owned;
    bool hasCode = false, hasConstants = false;
    for (Function &function : module) {
      if (isThisUnitsAlone(function) && !runBeforeMain.count(&function)) {
        function.setSection(code);
        owned.insert(&function);
        hasCode = true;
      }
    }
    // One without a name may also be used by what stays, and one may be used by
    // another. A constant that holds an address stays where the loader has
    // something to do to it, which is where code can be loaded anywhere. What
    // only it points to goes all the same.
    bool isLoadedAnywhere =
        isMachO || isCOFF || module.getPICLevel() != PICLevel::NotPIC;
    for (bool changed = true; changed;) {
      changed = false;
      for (GlobalVariable &variable : module.globals()) {
        if (owned.count(&variable) || !isThisUnitsAlone(variable) ||
            !variable.isConstant() || variable.isThreadLocal())
          continue;
        SmallPtrSet<const Value *, 16> seen;
        if (variable.hasLocalLinkage() && !isUsedOnlyBy(owned, variable, seen))
          continue;
        owned.insert(&variable);
        changed = true;
        if (variable.getInitializer()->needsRelocation() && isLoadedAnywhere)
          continue;
        variable.setSection(constants);
        // Else ELF has it in a section of the same name that the linker takes
        // apart to merge what is equal.
        variable.setUnnamedAddr(GlobalValue::UnnamedAddr::None);
        hasConstants = true;
      }
    }

    // Functions and variables are written in the order of these lists. Where
    // that were not so, what is outside the marks would stay in an executable
    // without the feature. It would not be taken for another unit's.
    LLVMContext &context = module.getContext();
    if (hasCode) {
      auto mark = [&](StringRef name) {
        auto *type = FunctionType::get(Type::getVoidTy(context), false);
        auto *function =
            Function::Create(type, GlobalValue::InternalLinkage, name);
        new UnreachableInst(context, BasicBlock::Create(context, "", function));
        function->setSection(code);
        function->addFnAttr(Attribute::NoUnwind);
        return function;
      };
      Function *begin = mark("bun_feature_code_begin"),
               *end = mark("bun_feature_code_end");
      module.getFunctionList().push_front(begin);
      module.getFunctionList().push_back(end);
      record(module, records, begin, end);
    }
    if (hasConstants) {
      auto mark = [&](StringRef name) {
        auto *byte = Type::getInt8Ty(context);
        auto *variable =
            new GlobalVariable(byte, true, GlobalValue::InternalLinkage,
                               ConstantInt::get(byte, 0), name);
        variable->setSection(constants);
        keepAsItIs(variable);
        return variable;
      };
      GlobalVariable *begin = mark("bun_feature_constants_begin"),
                     *end = mark("bun_feature_constants_end");
      module.insertGlobalVariable(module.global_begin(), begin);
      module.insertGlobalVariable(module.global_end(), end);
      record(module, records, begin, end);
    }
    return PreservedAnalyses::all();
  }

  // Also where nothing is optimized.
  static bool isRequired() { return true; }
};

} // namespace

extern "C" LLVM_ATTRIBUTE_WEAK PassPluginLibraryInfo llvmGetPassPluginInfo() {
  return {
      LLVM_PLUGIN_API_VERSION, "bun-feature", "1", [](PassBuilder &builder) {
        const char *features = featuresOption.empty()
                                   ? std::getenv("BUN_FEATURES")
                                   : featuresOption.c_str();
        if (!features)
          report_fatal_error("neither -bun-features nor BUN_FEATURES is set");
        builder.registerPipelineStartEPCallback(
            [](ModulePassManager &passes, OptimizationLevel) {
              passes.addPass(NoConstructors());
            });
        builder.registerOptimizerLastEPCallback(
            [features](ModulePassManager &passes, OptimizationLevel,
                       ThinOrFullLTOPhase) {
              passes.addPass(FeaturePass{{}, features});
            });
      }};
}
