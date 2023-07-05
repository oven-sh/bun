#include "root.h"

#include "JavaScriptCore/JavaScript.h"
#include "wtf/text/WTFString.h"
#include "JavaScriptCore/ObjectConstructor.h"

#if defined(__LINUX__)
#include <gnu/libc-version.h>
#endif

using namespace JSC;
using namespace WTF;

JSC::JSObject* createDetectLibcModule(JSC::JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    JSC::JSObject* object = nullptr;

    {
        JSC::ObjectInitializationScope initializationScope(vm);
        object = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);
        #if defined(__LINUX__)
            auto version = JSC::jsString(vm, makeAtomString(gnu_get_libc_version()));
            auto family = JSC::jsString(vm, makeAtomString("glibc"));
        #else
            auto version = JSC::jsNull();
            auto family = JSC::jsNull();
        #endif
        object->putDirect(vm, JSC::Identifier::fromString(vm, "version"_s), version, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);
        object->putDirect(vm, JSC::Identifier::fromString(vm, "family"_s), family, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);
    }

    return object;
}
