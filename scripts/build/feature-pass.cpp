// Puts what is compiled for features into an island, which `bun build --compile --compile-exclude-features` can leave out
// (src/bun_core/feature.rs says what a feature and an island are, src/exe_features leaves them out).
//
// An LLVM pass, as a plugin, because that is what every compiler bun is built with has in common:
//
//   BUN_ISLAND=7 rustc -Zllvm-plugins=<this>
//   clang -Xclang -load -Xclang <this> -fpass-plugin=<this> -mllvm -bun-island=7 -mllvm -bun-island-directory=<of the crate>
//
// rustc reads its options before it loads a plugin. ccache knows nothing of the environment.
//
// The whole compilation unit is the island's: nothing that stays depends on it, so nothing that stays can refer to what it
// alone defines. It stands in for an annotation that Rust does not have. `#[link_section]` is for one function that has a
// name, and much of what is compiled for a crate has none in the source: closures, the copies of generic functions of
// other crates that are made for its types, drop glue.

#include "llvm/IR/Constants.h"
#include "llvm/IR/DebugInfoMetadata.h"
#include "llvm/IR/Instructions.h"
#include "llvm/IR/Module.h"
#include "llvm/Passes/PassBuilder.h"
#include "llvm/Plugins/PassPlugin.h"
#include "llvm/Support/CommandLine.h"
#include "llvm/Support/Path.h"
#include "llvm/TargetParser/Triple.h"
#include "llvm/Transforms/Utils/ModuleUtils.h"
#include <cstdlib>

using namespace llvm;

namespace {

cl::opt<std::string> islandOption("bun-island", cl::desc("The number of the island of this compilation unit"));
cl::opt<std::string> directoryOption("bun-island-directory", cl::desc("Where the C and C++ of the island is"));

// What goes with the island. Not all of it is in it.
using Owned = SmallPtrSet<const GlobalObject*, 32>;

// What the linker may replace by the copy of another unit is not this unit's alone: an inline variable, a table of virtual
// functions and what is in it.
bool isThisUnitsAlone(const GlobalObject& global)
{
    return !global.isDeclaration() && !global.hasAvailableExternallyLinkage() && !global.isWeakForLinker()
        && !global.hasLinkOnceLinkage() && !global.hasSection();
}

// Whether an inline function or a template is the island's is a matter of where it is written: in the directory of the crate,
// or in a header of WebKit's, say, that Bun includes too. That is the same code that Bun has or could have, and the linker
// keeps one copy for all. One that was made for a type or a lambda that only this unit can name is one that only this
// unit can name.
bool isWrittenIn(StringRef directory, const Function& function)
{
    const DISubprogram* subprogram = function.getSubprogram();
    if (!subprogram || !subprogram->getFile())
        return false;
    SmallString<256> path(subprogram->getFile()->getFilename());
    sys::path::make_absolute(subprogram->getFile()->getDirectory(), path);
    sys::path::remove_dots(path, true);
    StringRef rest(path);
    return rest.consume_front(directory) && rest.starts_with("/");
}

bool isUsedOnlyBy(const Owned& owned, const Value& value, SmallPtrSetImpl<const Value*>& seen)
{
    for (const User* user : value.users()) {
        if (!seen.insert(user).second)
            continue;
        if (auto* instruction = dyn_cast<Instruction>(user)) {
            if (!owned.count(instruction->getFunction()))
                return false;
        } else if (auto* global = dyn_cast<GlobalObject>(user)) {
            if (!owned.count(global))
                return false;
        } else if (!isa<Constant>(user) || !isUsedOnlyBy(owned, *user, seen)) {
            return false;
        }
    }
    return true;
}

// What runs before main.
const GlobalVariable* constructorsOf(const Module& module)
{
    auto* constructors = module.getNamedGlobal("llvm.global_ctors");
    bool hasAny = constructors && constructors->hasInitializer() && !constructors->getInitializer()->isNullValue();
    return hasAny ? constructors : nullptr;
}

// Before anything else, when they are what the source has: they would run in an executable that no longer has them.
struct NoConstructors : PassInfoMixin<NoConstructors> {
    PreservedAnalyses run(Module& module, ModuleAnalysisManager&)
    {
        if (constructorsOf(module))
            report_fatal_error("a feature cannot have code that runs before main: " + Twine(module.getName()));
        return PreservedAnalyses::all();
    }

    static bool isRequired() { return true; }
};

struct IslandPass : PassInfoMixin<IslandPass> {
    std::string island;

    // COFF has room for few sections, and sorts what goes into one by what follows the "$" in its name. So there an island is
    // what has the name "$bun7.m", and this is what has the names before and after it, of which every unit has a copy and
    // the linker keeps one: where it starts, where it ends, and a record of {the two, as distances from it, the number}.
    void recordEdges(Module& module)
    {
        LLVMContext& context = module.getContext();
        auto keepOne = [&](GlobalObject* global) {
            global->setComdat(module.getOrInsertComdat(global->getName()));
            return global;
        };
        std::string name = "bun_island_" + island + "_code";
        auto edge = [&](StringRef which, StringRef prefix) {
            auto* type = FunctionType::get(Type::getVoidTy(context), false);
            auto* function = Function::Create(type, GlobalValue::LinkOnceODRLinkage, name + which, module);
            new UnreachableInst(context, BasicBlock::Create(context, "", function));
            function->setSectionPrefix(("bun" + island + prefix).str());
            function->addFnAttr(Attribute::NoUnwind);
            return keepOne(function);
        };
        GlobalObject *start = edge("_start", ".a"), *end = edge("_end", ".z");

        auto* word = Type::getInt32Ty(context);
        auto* address = Type::getInt64Ty(context);
        auto* type = ArrayType::get(word, 3);
        auto* record = new GlobalVariable(module, type, true, GlobalValue::LinkOnceODRLinkage, nullptr, name);
        auto distanceTo = [&](GlobalObject* edge) {
            auto* distance = ConstantExpr::getSub(ConstantExpr::getPtrToInt(edge, address), ConstantExpr::getPtrToInt(record, address));
            return ConstantExpr::getTrunc(distance, word);
        };
        record->setInitializer(ConstantArray::get(type, { distanceTo(start), distanceTo(end), ConstantInt::get(word, std::stoul(island)) }));
        record->setSection(".bunisl");
        record->setAlignment(Align(4));
        appendToUsed(module, { keepOne(record) });
    }

    PreservedAnalyses run(Module& module, ModuleAnalysisManager&)
    {
        // src/exe_features/lib.rs has these names too. An island is what the linker itself says is one, and within one it drops,
        // folds and moves as it likes: lld folds only what ends up in the same section, or on COFF has the same name.
        //
        // What is given the name of a section is one piece per unit, though, of which the linker can neither drop nor fold a
        // part. Not on Mach-O. On ELF a flag of the link has each function and constant be a piece
        // (scripts/build/flags.ts). On COFF a function with a prefix stays one, and LLVM has no prefix for a constant
        // there, so those stay where they are: as one piece, no two of them are folded, nor the functions that use them.
        const Triple& target = module.getTargetTriple();
        bool isMachO = target.isOSBinFormatMachO(), isCOFF = target.isOSBinFormatCOFF();
        std::string code = isMachO ? "__TEXT,__bun_x" + island + ",regular,pure_instructions" : ".bun_island_x." + island;
        std::string constants = isMachO ? "__TEXT,__bun_r" + island : ".bun_island_r." + island;

        // Those that there are by now are the compiler's, a sanitizer's for one, and stay.
        SmallPtrSet<const Value*, 4> runBeforeMain;
        if (auto* constructors = constructorsOf(module)) {
            for (const Use& entry : cast<ConstantArray>(constructors->getInitializer())->operands())
                runBeforeMain.insert(cast<ConstantStruct>(entry)->getOperand(1)->stripPointerCasts());
        }

        // An inline function or a template is in every unit that uses it, and the linker keeps one copy for all of them, by name.
        // Which copy is called makes no difference, only which one an address is of. So one of the island's that is only
        // called gets a name that it has in this island alone, and the island a copy of its own.
        DenseMap<const Comdat*, unsigned> membersOf;
        for (const GlobalObject& global : module.global_objects())
            membersOf[global.getComdat()]++;
        SmallPtrSet<const Function*, 32> ofTheIsland;
        for (Function& function : module) {
            const Comdat* comdat = function.getComdat();
            bool isAlone = !comdat || membersOf[comdat] == 1;
            if (!function.hasLinkOnceODRLinkage() || function.isDeclaration() || function.hasAddressTaken() || !isAlone || !isWrittenIn(directoryOption, function))
                continue;
            function.setName(function.getName() + ".bun" + island);
            if (comdat) {
                function.setComdat(module.getOrInsertComdat(function.getName()));
                function.getComdat()->setSelectionKind(comdat->getSelectionKind());
            }
            ofTheIsland.insert(&function);
        }

        Owned owned;
        for (GlobalObject& global : module.global_objects()) {
            if ((isThisUnitsAlone(global) || ofTheIsland.count(dyn_cast<Function>(&global))) && !runBeforeMain.count(&global))
                owned.insert(&global);
        }
        // What stays can use what only this unit can name: an inline function of a header calls a static one, and it may be
        // this unit's copy of the inline one that the linker keeps for all of Bun. That stays too, and what it uses.
        for (bool changed = true; changed;) {
            changed = false;
            for (const GlobalObject* global : SmallVector<const GlobalObject*, 0>(owned.begin(), owned.end())) {
                SmallPtrSet<const Value*, 16> seen;
                if (global->hasLocalLinkage() && !isUsedOnlyBy(owned, *global, seen)) {
                    owned.erase(global);
                    changed = true;
                }
            }
        }

        // Code and constants are what an island has. What is written to is not moved, nor a constant that holds an address where
        // the loader has something to do to it, which is where code can be loaded anywhere. What only they point to goes
        // all the same.
        bool isLoadedAnywhere = isMachO || isCOFF || module.getPICLevel() != PICLevel::NotPIC;
        bool hasCode = false;
        for (GlobalObject& global : module.global_objects()) {
            if (!owned.count(&global))
                continue;
            if (auto* function = dyn_cast<Function>(&global)) {
                if (isCOFF)
                    function->setSectionPrefix("bun" + island + ".m");
                else
                    function->setSection(code);
                hasCode = true;
                continue;
            }
            auto& variable = cast<GlobalVariable>(global);
            bool isPatched = variable.getInitializer()->needsRelocation() && isLoadedAnywhere;
            if (variable.isConstant() && !variable.isThreadLocal() && !isPatched && !isCOFF)
                variable.setSection(constants);
        }

        if (isCOFF && hasCode)
            recordEdges(module);
        return PreservedAnalyses::all();
    }

    // Also where nothing is optimized.
    static bool isRequired() { return true; }
};

} // namespace

extern "C" LLVM_ATTRIBUTE_WEAK PassPluginLibraryInfo llvmGetPassPluginInfo()
{
    return { LLVM_PLUGIN_API_VERSION, "bun-island", "1", [](PassBuilder& builder) {
                const char* island = islandOption.empty() ? std::getenv("BUN_ISLAND") : islandOption.c_str();
                if (!island)
                    report_fatal_error("neither -bun-island nor BUN_ISLAND is set");
                builder.registerPipelineStartEPCallback(
                    [](ModulePassManager& passes, OptimizationLevel) { passes.addPass(NoConstructors()); });
                builder.registerOptimizerLastEPCallback(
                    [island](ModulePassManager& passes, OptimizationLevel, ThinOrFullLTOPhase) {
                        passes.addPass(IslandPass { {}, island });
                    });
            } };
}
