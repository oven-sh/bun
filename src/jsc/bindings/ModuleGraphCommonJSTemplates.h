#pragma once

// Thin wrapper around a WeakGCMap so ZigGlobalObject.h can hold a
// std::unique_ptr to it without pulling in WeakGCMap.h.
//
// The FunctionExecutable of a CommonJS wrapper evaluated for a
// Bun.unsafe.ModuleGraph, by (file name, overlay symbol table): every graph with
// that overlay shape that loads the file gets a function of its own over this
// executable, so they share CodeBlocks and JIT code. Weak: it lives as long as
// one of those functions does.

#include "root.h"
#include <JavaScriptCore/WeakGCMap.h>
#include <JavaScriptCore/FunctionExecutable.h>
#include <JavaScriptCore/SymbolTable.h>

namespace Bun {

class ModuleGraphCommonJSTemplates {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(ModuleGraphCommonJSTemplates);

public:
    // The name's impl is not kept alive by the map; a hit is verified against the
    // source URL and text before use (JSCommonJSModule.cpp).
    using Key = std::pair<UniquedStringImpl*, JSC::SymbolTable*>;

    explicit ModuleGraphCommonJSTemplates(JSC::VM& vm)
        : m_map(vm)
    {
    }

    JSC::FunctionExecutable* get(Key key) { return m_map.get(key); }
    void set(Key key, JSC::FunctionExecutable* value) { m_map.set(key, JSC::Weak<JSC::FunctionExecutable>(value)); }

private:
    JSC::WeakGCMap<Key, JSC::FunctionExecutable> m_map;
};

} // namespace Bun
