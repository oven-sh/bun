#pragma once

#include "root.h"

namespace Bun {

// The realm of a web page in `bun:desktop/electron`: a global object of its own on this thread, whose modules are
// named by URL and come from `src/js/internal/desktop/electron/realm.ts`.
JSC_DECLARE_HOST_FUNCTION(jsFunctionCreateDesktopRealm);
JSC_DECLARE_HOST_FUNCTION(jsFunctionSealDesktopRealm);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDisposeDesktopRealm);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDesktopRealmSetEvalEnabled);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDesktopRealmEvaluate);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDesktopRealmImport);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDesktopRealmWhereThrown);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDesktopRealmLoadModule);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDesktopRealmEvaluateModule);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDesktopRealmIsCompiled);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDesktopRealmRunCompiled);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDesktopRealmModuleSource);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDesktopRealmCacheAccessors);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDesktopRealmDefineLazily);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDesktopRealmShareGlobals);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDesktopRealmIsDisturbed);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDesktopRealmSetPaused);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDesktopRealmCopyPlainData);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDesktopRealmHasLocalMessages);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDesktopRealmRequireTrustedScripts);

bool desktopRealmHandlesUncaughtException(JSC::JSGlobalObject*, JSC::JSValue error);
// For a URL whose origin is otherwise opaque. Empty in any other realm.
JSC::JSValue desktopRealmOriginOf(JSC::JSGlobalObject*, const String& href);

bool isDesktopRealm(JSC::JSGlobalObject*);
JSC::JSValue callDesktopRealmHook(JSC::JSGlobalObject*, ASCIILiteral name, JSC::JSValue, JSC::JSValue);
// The plain object that stands for a platform object in a structured clone. Null for any other object.
JSC::JSObject* desktopRealmSerialize(JSC::JSGlobalObject*, JSC::JSObject*, bool isForStorage);
// In the realm of a page, a File has a prototype of its own.
void desktopRealmAdoptFile(JSC::JSGlobalObject*, JSC::JSValue blob);
JSC::JSValue desktopRealmDeserialize(JSC::JSGlobalObject*, JSC::JSObject* serialized);

} // namespace Bun
