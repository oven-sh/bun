#pragma once

#include "root.h"
#include <JavaScriptCore/Identifier.h>

namespace JSC {
class JSModuleNamespaceObject;
}

// Module mocks and spies store to the export variables of loaded ES modules. Two export names, and two modules, can export one
// variable. So the record that declares a variable keeps what the stores to it replaced: the value the variable had before the
// first store, and every store that stands, with its owner. The variable shows the newest store that stands, and no store ever
// takes the value of another for the variable's own. Mock code stores to an export nowhere else:
// test/internal/source-lints/module-export-override-callers.test.ts.
namespace Bun {

// Stores `value` in the variable that `name` exports, as the newest store of `owner` there. False if `owner` got no store:
// `name` is no variable that takes one, or `value` is what the variable shows already and that is not the store of `owner`.
// A mock's factory that spreads the exports it read hands every one of them back like that.
bool overrideExport(JSC::JSGlobalObject*, JSC::JSModuleNamespaceObject*, const JSC::Identifier& name, JSC::JSValue value, JSC::JSObject* owner);

// Ends the store of `owner`. If the variable showed it, the variable gets the newest store that still stands, or the value it
// had before them all. If a mock function stands over it and calls it, that function calls what is beneath it now.
void restoreExport(JSC::JSGlobalObject*, JSC::JSModuleNamespaceObject*, const JSC::Identifier& name, JSC::JSObject* owner);

// What the variable would show without the store of `owner`, and without the stores made after it. `hasStored` is false if `owner`
// has no store there: it is what the namespace object gives. Empty with `hasStored` if the variable had no value then and has none yet.
JSC::JSValue exportBeneathOverride(JSC::JSGlobalObject*, JSC::JSModuleNamespaceObject*, const JSC::Identifier& name, JSC::JSObject* owner, bool& hasStored);

}
