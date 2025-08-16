#pragma once

namespace JSC {
    class JSValue;
    class VM;
    class JSObject;
}

namespace Bun {
    JSC::JSValue constructProcessStorageObject(JSC::VM& vm, JSC::JSObject* bunObject);
}