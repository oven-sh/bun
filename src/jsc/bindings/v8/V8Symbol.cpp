#include "V8Symbol.h"
#include "V8HandleScope.h"
#include "v8_compatibility_assertions.h"

#include <JavaScriptCore/Symbol.h>

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Symbol)

namespace v8 {

Local<Symbol> Symbol::GetIterator(Isolate* isolate)
{
    auto& vm = isolate->vm();
    // A Symbol cell over the well-known uid is the same property key as Symbol.iterator.
    auto* symbol = JSC::Symbol::create(vm, static_cast<WTF::SymbolImpl&>(*vm.propertyNames->iteratorSymbol.impl()));
    return isolate->currentHandleScope()->createLocal<Symbol>(vm, symbol);
}

} // namespace v8
