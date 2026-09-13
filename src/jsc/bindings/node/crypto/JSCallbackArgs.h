#pragma once

#include "root.h"

namespace Bun {

// The arguments an async crypto job's completion callback will be invoked
// with, returned by value from the ctx's JS-thread half (`runFromJS`). The
// native side only builds this value; the job plumbing in
// node_crypto_binding.rs frees the ctx and then calls the JS callback with it
// (mirrored there as `JsCallbackArgs`). The default-constructed value (no
// arguments) is the discard returned alongside a pending exception.
struct JSCallbackArgs {
    JSCallbackArgs() = default;
    JSCallbackArgs(JSC::JSValue arg0)
        : m_argv { JSC::JSValue::encode(arg0) }
        , m_argc(1)
    {
    }
    JSCallbackArgs(JSC::JSValue arg0, JSC::JSValue arg1)
        : m_argv { JSC::JSValue::encode(arg0), JSC::JSValue::encode(arg1) }
        , m_argc(2)
    {
    }
    JSCallbackArgs(JSC::JSValue arg0, JSC::JSValue arg1, JSC::JSValue arg2)
        : m_argv { JSC::JSValue::encode(arg0), JSC::JSValue::encode(arg1), JSC::JSValue::encode(arg2) }
        , m_argc(3)
    {
    }

private:
    JSC::EncodedJSValue m_argv[3] = { 0, 0, 0 };
    // Read on the Rust side only (node_crypto_binding.rs).
    [[maybe_unused]] uint32_t m_argc = 0;
};

static_assert(std::is_trivially_copyable_v<JSCallbackArgs>, "copied through an extern \"C\" out-pointer");

} // namespace Bun
