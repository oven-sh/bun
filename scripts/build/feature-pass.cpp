// Puts what is compiled for a feature into sections of its own, which `bun build --compile --compile-exclude-features` can
// then leave out (src/bun_core/feature.rs says what a feature is, src/exe_features leaves it out).
//
// An LLVM pass, as a plugin, because that is what every compiler bun is built with has in common:
//
//   BUN_FEATURES=6 rustc -Zllvm-plugins=<this>
//   BUN_FEATURES=6 clang -fpass-plugin=<this>
//
// The number is the features that need the compilation unit, a bit for each, in hex. The whole unit is theirs: nothing that
// stays depends on it, so nothing that stays can refer to what it alone defines.

#include "llvm/IR/Constants.h"
#include "llvm/IR/Instructions.h"
#include "llvm/IR/Module.h"
#include "llvm/Passes/PassBuilder.h"
#include "llvm/Plugins/PassPlugin.h"
#include "llvm/TargetParser/Triple.h"
#include <cstdlib>

using namespace llvm;

namespace {

using Moved = SmallPtrSet<const GlobalObject*, 32>;

// What the linker may replace by the copy of another unit is not this unit's alone: a C++ template, an inline function.
bool isThisUnitsAlone(const GlobalObject& global)
{
    return !global.isDeclaration() && !global.hasAvailableExternallyLinkage() && !global.isWeakForLinker()
        && !global.hasLinkOnceLinkage() && !global.hasSection();
}

bool isUsedOnlyBy(const Moved& moved, const Value& value, SmallPtrSetImpl<const Value*>& seen)
{
    for (const User* user : value.users()) {
        if (!seen.insert(user).second)
            continue;
        if (auto* instruction = dyn_cast<Instruction>(user)) {
            if (!moved.count(instruction->getFunction()))
                return false;
        } else if (auto* global = dyn_cast<GlobalObject>(user)) {
            if (!moved.count(global))
                return false;
        } else if (!isa<Constant>(user) || !isUsedOnlyBy(moved, *user, seen)) {
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

struct FeaturePass : PassInfoMixin<FeaturePass> {
    std::string features;

    PreservedAnalyses run(Module& module, ModuleAnalysisManager&)
    {

        // src/exe_features/lib.rs has these names too.
        const Triple& target = module.getTargetTriple();
        std::string code = target.isOSBinFormatMachO() ? "__TEXT,__bun_feat_x" + features + ",regular,pure_instructions"
            : target.isOSBinFormatCOFF()               ? ".bfx" + features
                                                       : ".bun_feature_x." + features;
        std::string constants = target.isOSBinFormatMachO() ? "__TEXT,__bun_feat_r" + features
            : target.isOSBinFormatCOFF()                    ? ".bfr" + features
                                                            : ".bun_feature_r." + features;

        // Those that there are by now are the compiler's, a sanitizer's for one, and stay.
        SmallPtrSet<const Value*, 4> runBeforeMain;
        if (auto* constructors = constructorsOf(module)) {
            for (const Use& entry : cast<ConstantArray>(constructors->getInitializer())->operands())
                runBeforeMain.insert(cast<ConstantStruct>(entry)->getOperand(1)->stripPointerCasts());
        }

        Moved moved;
        for (Function& function : module) {
            if (isThisUnitsAlone(function) && !runBeforeMain.count(&function)) {
                function.setSection(code);
                moved.insert(&function);
            }
        }
        // Constants that hold no address: the loader has nothing to do to those. One without a name may also be used by what
        // did not move, and one may be used by another.
        for (bool changed = true; changed;) {
            changed = false;
            for (GlobalVariable& variable : module.globals()) {
                if (moved.count(&variable) || !isThisUnitsAlone(variable) || !variable.isConstant()
                    || variable.isThreadLocal() || variable.getInitializer()->needsRelocation())
                    continue;
                SmallPtrSet<const Value*, 16> seen;
                if (variable.hasLocalLinkage() && !isUsedOnlyBy(moved, variable, seen))
                    continue;
                variable.setSection(constants);
                moved.insert(&variable);
                changed = true;
            }
        }
        return PreservedAnalyses::all();
    }

    // Also where nothing is optimized.
    static bool isRequired() { return true; }
};

} // namespace

extern "C" LLVM_ATTRIBUTE_WEAK PassPluginLibraryInfo llvmGetPassPluginInfo()
{
    return { LLVM_PLUGIN_API_VERSION, "bun-feature", "1", [](PassBuilder& builder) {
                const char* features = std::getenv("BUN_FEATURES");
                if (!features)
                    report_fatal_error("BUN_FEATURES is not set");
                builder.registerPipelineStartEPCallback(
                    [](ModulePassManager& passes, OptimizationLevel) { passes.addPass(NoConstructors()); });
                builder.registerOptimizerLastEPCallback(
                    [features](ModulePassManager& passes, OptimizationLevel, ThinOrFullLTOPhase) {
                        passes.addPass(FeaturePass { {}, features });
                    });
            } };
}
