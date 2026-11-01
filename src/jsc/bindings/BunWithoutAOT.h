#pragma once

// What Bun's bindings ask of JavaScriptCore's ahead-of-time run time, in a Bun built with ENABLE_AOT=0: no image is ever registered, no object is a compiled
// object, and every notice to the run time goes nowhere. root.h includes this, so a call site reads the same in both builds.

#if !ENABLE(AOT)

#include <JavaScriptCore/AOTImage.h>
#include <span>
#include <wtf/IterationStatus.h>
#include <wtf/text/ASCIILiteral.h>
#include <wtf/text/StringView.h>

namespace JSC {

class AbstractModuleRecord;
class Symbol;

namespace AOT {

struct ModuleHost {};

class ModuleID {
public:
    constexpr uint32_t index() const { return 0; }
};

class AskerOfModule {
public:
    AskerOfModule(JSGlobalObject*, const String&) {}
};

enum class LoadByName : uint8_t { Require,
    Import };
enum class RequireOverride : uint8_t {
    ResolveFilename = 1 << 0,
    RequireFunction = 1 << 1,
};

inline void willLoadByName(JSGlobalObject*, JSValue, LoadByName = LoadByName::Require) {}
inline void willAnswerWithModule(JSGlobalObject*, ModuleID, LoadByName = LoadByName::Require) {}
inline void willChangeRequireOverride(JSGlobalObject*, RequireOverride, bool) {}
inline bool isCompiledModuleRecord(AbstractModuleRecord*) { return false; }
inline bool entryPointIsCommonJS(JSGlobalObject*) { return false; }
inline bool isModuleNamespace(JSCell*) { return false; }
inline bool hasESModuleMarker(JSCell*) { return false; }
inline void setESModuleMarker(JSCell*, bool) {}

inline void lockBuiltinsWithoutImage() {}
inline ASCIILiteral evaluationRefusedMessage() { return ""_s; }
inline void hostDidCreateRealm(JSGlobalObject*) {}
inline void hostDidCreateStructure(JSGlobalObject*, Structure*) {}
inline void hostDidCreateConstructor(JSGlobalObject*, JSObject*) {}
inline void hostDidCreateNodeModule(JSGlobalObject*, JSObject*) {}
inline void hostDidCreateObjectOfGlobal(JSGlobalObject*, UniquedStringImpl*, JSObject*) {}
inline void hostDidFillObjectWithFoldedMembers(JSGlobalObject*, JSObject*, ASCIILiteral, std::span<const ASCIILiteral>) {}
inline void hostDidReplaceProperty(JSGlobalObject*, UniquedStringImpl*) {}
inline void hostDidLoadBuiltinModule(JSGlobalObject*, uint32_t, JSValue) {}

inline bool hasBuiltinModule(JSGlobalObject*, uint32_t) { return false; }
inline bool refusesLibraryText() { return false; }
inline bool refusesLibraryText(JSGlobalObject*) { return false; }
inline bool refusesToRun(JSFunction*) { return false; }
inline bool isNeededByNothingThatRuns(JSFunction*) { return false; }
inline void throwBuiltinNotCompiled(JSGlobalObject*, const String&) {}

namespace PropertyWalk {

struct OwnProperty {
    UniquedStringImpl* name;
    JSValue value;
    unsigned attributes;
};

enum class Filter : uint8_t { EnumerableStrings,
    Strings,
    StringsAndSymbols };
enum class Result : uint8_t { Completed,
    Stopped,
    NeedsGenericPath };
enum class Presence : uint8_t { Present,
    Absent,
    Unknown };

constexpr bool isCompiledObject(const JSCell*) { return false; }
template<typename Functor> Result forEachOwnProperty(VM&, JSObject*, Filter, const Functor&) { return Result::NeedsGenericPath; }
inline void materializeLazyProperties(VM&, JSObject*) {}
inline void prepareHoldersBeforeLookupsUnder(JSGlobalObject*, Symbol*, JSObject*) {}
inline Presence tryGetOwnValue(JSObject*, UniquedStringImpl*, JSValue&) { return Presence::Unknown; }
inline UniquedStringImpl* tryFindName(VM&, std::span<const Latin1Character>) { return nullptr; }

} // namespace PropertyWalk

}
} // namespace JSC::AOT

#endif // !ENABLE(AOT)
