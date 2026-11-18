#pragma once

#include "Test.h"
#include "engine/Engine.h"

namespace Test {

// A VM with one realm. It records what the engine asks of its embedder.
class Realm {
public:
    explicit Realm(const JSC::GlobalObjectMethodTable* = nullptr);
    ~Realm();

    JSC::JSValue run(ASCIILiteral source);
    String text(JSC::JSValue);
    String json(JSC::JSValue value) { return JSC::JSONStringify(global, value, 0); }
    void define(ASCIILiteral name, JSC::JSValue value) { global->putDirect(vm, JSC::Identifier::fromString(vm, name), value); }
    JSC::JSFunction* function(JSC::NativeStdFunction&& code) { return JSC::JSNativeStdFunction::create(vm, global, 0, {}, WTF::move(code)); }
    JSC::JSGlobalObject* createGlobalObject(const JSC::GlobalObjectMethodTable* = nullptr);
    // The text of the pending exception, which it clears.
    String takeException();
    void collect() { vm.heap.collectNow(JSC::Sync, JSC::CollectionScope::Full); }

    static void log(const String&);
    // What has been logged since the last call, with commas in between.
    static String takeLog();

    JSC::VM& vm;
    JSC::JSGlobalObject* global;
};

}
