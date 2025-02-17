#pragma once

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(functionBunPeek);
JSC_DECLARE_HOST_FUNCTION(functionBunPeekStatus);
JSC_DECLARE_HOST_FUNCTION(functionBunSleep);
JSC_DECLARE_HOST_FUNCTION(functionBunEscapeHTML);
JSC_DECLARE_HOST_FUNCTION(functionBunDeepEquals);
JSC_DECLARE_HOST_FUNCTION(functionBunDeepMatch);
JSC_DECLARE_HOST_FUNCTION(functionBunNanoseconds);
JSC_DECLARE_HOST_FUNCTION(functionPathToFileURL);
JSC_DECLARE_HOST_FUNCTION(functionFileURLToPath);

JSC::JSValue constructBunFetchObject(VM& vm, JSObject* bunObject);
JSC::JSObject* createBunObject(VM& vm, JSObject* globalObject);

/*
static JSValue BunObject_getter_wrap_BunShell(VM& vm, JSObject* bunObject)
{
    auto* globalObject = defaultGlobalObject(bunObject->globalObject());
    return globalObject->m_BunShell.getInitializedOnMainThread(globalObject);
}

static JSValue BunObject_getter_wrap_ShellError(VM& vm, JSObject* bunObject)
{
    auto* globalObject = defaultGlobalObject(bunObject->globalObject());
    return globalObject->m_BunShell.getInitializedOnMainThread(globalObject)->get(globalObject, JSC::Identifier::fromString(vm, "ShellError"_s));
}
*/

JSC::JSObject* BunShell(JSGlobalObject* globalObject);
JSC::JSValue ShellError(JSGlobalObject* globalObject);

}
