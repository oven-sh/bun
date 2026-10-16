#include "config.h"
#include "JSWindow.h"

#include "DOMBindingsModuleExports.h"
#include "JSAbortController.h"
#include "JSAbortSignal.h"
#include "JSCloseEvent.h"
#include "JSCustomEvent.h"
#include "JSDOMCSSNamespace.h"
#include "JSDOMConstructorBase.h"
#include "JSDOMException.h"
#include "JSDOMFormData.h"
#include "JSDOMWrapperCache.h"
#include "JSErrorEvent.h"
#include "JSEvent.h"
#include "JSEventTarget.h"
#include "JSMessageEvent.h"
#include "JSWindowCustom.h"
#include "JSWindowInterfaces.h"
#include "WebCoreOpaqueRootInlines.h"
#include "JSNodeCustomInlines.h"
#include "Window.h"
#include "headers.h"
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSGlobalProxy.h>
#include <JavaScriptCore/PropertyNameArray.h>

namespace WebCore {
using namespace JSC;

// JSWindow's static property table (JSWindowInterfaces.lut.txt) names one of these for each interface.
// JSC calls it when the property is first read and stores what it returns on that window's wrapper.

static JSValue constructorForWindow(VM& vm, JSObject* window, JSValue constructor)
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* copy = JSDOMConstructorBase::createForWindow(vm, *uncheckedDowncast<JSDOMConstructorBase>(constructor), uncheckedDowncast<JSWindow>(window)->wrapped(), *window);
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return jsUndefined();
    }
    return copy;
}

template<typename WrapperClass> static constexpr bool constructorNeedsWindow = false;
#define CONSTRUCTOR_NEEDS_WINDOW(name, wrapperClass) template<> constexpr bool constructorNeedsWindow<wrapperClass> = true;
FOR_EACH_DOM_BINDINGS_WINDOW_BOUND_INTERFACE(CONSTRUCTOR_NEEDS_WINDOW)
#undef CONSTRUCTOR_NEEDS_WINDOW

#define DEFINE_WINDOW_INTERFACE(name, wrapperClass)                                \
    JSValue windowInterface_##name(VM& vm, JSObject* window)                       \
    {                                                                              \
        JSValue constructor = wrapperClass::getConstructor(vm, window->globalObject()); \
        if constexpr (constructorNeedsWindow<wrapperClass>)                        \
            return constructorForWindow(vm, window, constructor);                  \
        return constructor;                                                        \
    }
FOR_EACH_DOM_BINDINGS_INTERFACE(DEFINE_WINDOW_INTERFACE)
DEFINE_WINDOW_INTERFACE(AbortController, JSAbortController)
DEFINE_WINDOW_INTERFACE(CSS, JSDOMCSSNamespace)
DEFINE_WINDOW_INTERFACE(AbortSignal, JSAbortSignal)
DEFINE_WINDOW_INTERFACE(CloseEvent, JSCloseEvent)
DEFINE_WINDOW_INTERFACE(CustomEvent, JSCustomEvent)
DEFINE_WINDOW_INTERFACE(DOMException, JSDOMException)
DEFINE_WINDOW_INTERFACE(ErrorEvent, JSErrorEvent)
DEFINE_WINDOW_INTERFACE(Event, JSEvent)
DEFINE_WINDOW_INTERFACE(EventTarget, JSEventTarget)
DEFINE_WINDOW_INTERFACE(FormData, JSDOMFormData)
DEFINE_WINDOW_INTERFACE(MessageEvent, JSMessageEvent)
#undef DEFINE_WINDOW_INTERFACE

#define DEFINE_WINDOW_FACTORY_FUNCTION(name, wrapperClass)                         \
    JSValue windowInterface_##name(VM& vm, JSObject* window)                       \
    {                                                                              \
        return constructorForWindow(vm, window, wrapperClass::getLegacyFactoryFunction(vm, window->globalObject())); \
    }
FOR_EACH_DOM_BINDINGS_LEGACY_FACTORY_FUNCTION(DEFINE_WINDOW_FACTORY_FUNCTION)
#undef DEFINE_WINDOW_FACTORY_FUNCTION

JSValue windowInterface_Blob(VM&, JSObject* window)
{
    return uncheckedDowncast<JSDOMGlobalObject>(window->globalObject())->JSBlobConstructor();
}

JSValue windowInterface_File(VM&, JSObject* window)
{
    return uncheckedDowncast<JSDOMGlobalObject>(window->globalObject())->JSDOMFileConstructor();
}

// `const { getComputedStyle } = window` has to keep working. In a browser, a function called without `this` uses its
// realm's global object, which is the window it was read from. Here a realm has many windows, so each binds its own.
static JSValue operationForWindow(VM& vm, JSObject* window, ASCIILiteral name, unsigned length)
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSGlobalObject* globalObject = window->globalObject();
    JSValue operation = window->getPrototypeDirect().get(globalObject, Identifier::fromString(vm, name));
    if (!scope.exception() && operation.isCallable()) {
        JSString* nameString = jsString(vm, String(name));
        auto* bound = JSBoundFunction::create(vm, globalObject, asObject(operation), window, ArgList(), length, nameString, makeSource(name, SourceOrigin(), SourceTaintedOrigin::Untainted));
        if (!scope.exception()) {
            // A bound function makes its "bound " name when `name` is first looked up, so look it up before replacing it.
            PropertySlot slot(bound, PropertySlot::InternalMethodType::VMInquiry, &vm);
            bound->methodTable()->getOwnPropertySlot(bound, globalObject, vm.propertyNames->name, slot);
            if (!scope.exception()) {
                bound->putDirect(vm, vm.propertyNames->name, nameString, PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum);
                return bound;
            }
        }
    }
    (void)scope.tryClearException();
    return jsUndefined();
}

#define FOR_EACH_WINDOW_OPERATION(macro) \
    macro(addEventListener, 2) \
    macro(alert, 0) \
    macro(blur, 0) \
    macro(cancelAnimationFrame, 1) \
    macro(close, 0) \
    macro(confirm, 0) \
    macro(dispatchEvent, 1) \
    macro(focus, 0) \
    macro(getComputedStyle, 1) \
    macro(getSelection, 0) \
    macro(matchMedia, 1) \
    macro(moveBy, 0) \
    macro(moveTo, 0) \
    macro(open, 0) \
    macro(postMessage, 1) \
    macro(print, 0) \
    macro(prompt, 0) \
    macro(removeEventListener, 2) \
    macro(requestAnimationFrame, 1) \
    macro(resizeBy, 0) \
    macro(resizeTo, 0) \
    macro(scroll, 0) \
    macro(scrollBy, 0) \
    macro(scrollTo, 0) \
    macro(stop, 0)

#define DEFINE_WINDOW_OPERATION(name, length)                   \
    JSValue windowOperation_##name(VM& vm, JSObject* window)    \
    {                                                           \
        return operationForWindow(vm, window, #name##_s, length); \
    }
FOR_EACH_WINDOW_OPERATION(DEFINE_WINDOW_OPERATION)
#undef DEFINE_WINDOW_OPERATION
#undef FOR_EACH_WINDOW_OPERATION

JSValue JSWindow::event(JSGlobalObject& lexicalGlobalObject) const
{
    auto* event = wrapped().currentEvent();
    return event ? toJS(&lexicalGlobalObject, realm(), *event) : jsUndefined();
}

// Always the wrapper, also where toJS() gives `globalThis`: that has no `frames[0]`.
JSValue JSWindow::frames(JSGlobalObject&) const
{
    return const_cast<JSWindow*>(this);
}

// `window[0]`: the windows of the frames.
bool JSWindow::getOwnPropertySlot(JSObject* object, JSGlobalObject* lexicalGlobalObject, PropertyName propertyName, PropertySlot& slot)
{
    if (auto index = parseIndex(propertyName))
        return getOwnPropertySlotByIndex(object, lexicalGlobalObject, *index, slot);
    return Base::getOwnPropertySlot(object, lexicalGlobalObject, propertyName, slot);
}

bool JSWindow::getOwnPropertySlotByIndex(JSObject* object, JSGlobalObject* lexicalGlobalObject, unsigned index, PropertySlot& slot)
{
    // JSC reads an indexed property that script has defined without asking here, so such a property comes first.
    if (Base::getOwnPropertySlotByIndex(object, lexicalGlobalObject, index, slot))
        return true;
    auto* thisObject = uncheckedDowncast<JSWindow>(object);
    RefPtr window = thisObject->wrapped().item(index);
    if (!window)
        return false;
    slot.setValue(thisObject, static_cast<unsigned>(PropertyAttribute::ReadOnly), toJS(lexicalGlobalObject, thisObject->realm(), *window));
    return true;
}

void JSWindow::getOwnPropertyNames(JSObject* object, JSGlobalObject* lexicalGlobalObject, PropertyNameArrayBuilder& propertyNames, DontEnumPropertiesMode mode)
{
    VM& vm = getVM(lexicalGlobalObject);
    for (unsigned i = 0, count = uncheckedDowncast<JSWindow>(object)->wrapped().length(); i < count; ++i)
        propertyNames.add(Identifier::from(vm, i));
    Base::getOwnPropertyNames(object, lexicalGlobalObject, propertyNames, mode);
}

bool JSWindowOwner::isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown> handle, void*, AbstractSlotVisitor& visitor, ASCIILiteral* reason)
{
    auto& window = uncheckedDowncast<JSWindow>(handle.slot()->asCell())->wrapped();
    if (window.hasPendingTasks()) {
        if (reason) [[unlikely]]
            *reason = "Window has a task in the queue"_s;
        return true;
    }
    if (reason) [[unlikely]]
        *reason = "Reachable from Document"_s;
    if (auto* document = window.document(); document && containsWebCoreOpaqueRoot(visitor, document))
        return true;
    auto containerRoot = window.containerOpaqueRoot();
    return containerRoot.pointer() && containsWebCoreOpaqueRoot(visitor, containerRoot);
}

template<typename Visitor>
void JSWindow::visitAdditionalChildrenInGCThread(Visitor& visitor)
{
    auto& window = wrapped();
    addWebCoreOpaqueRoot(visitor, window.document());
    addWebCoreOpaqueRoot(visitor, window.containerOpaqueRoot());
    if (auto* opener = window.opener())
        addWebCoreOpaqueRoot(visitor, opener->document());
}

DEFINE_VISIT_ADDITIONAL_CHILDREN_IN_GC_THREAD(JSWindow);

JSValue toJSNewlyCreated(JSGlobalObject*, JSDOMGlobalObject* globalObject, Ref<Window>&& window)
{
    return createWrapper<Window>(globalObject, WTF::move(window));
}

// Native code that needs the wrapper itself calls wrap().
JSValue toJS(JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, Window& window)
{
    if (window.isGlobalThis()) [[unlikely]]
        return globalObject->globalThis();
    return wrap(lexicalGlobalObject, globalObject, window);
}

Window* JSWindow::toWrapped(VM&, JSValue value)
{
    if (auto* window = dynamicDowncast<JSWindow>(value))
        return &window->wrapped();
    // Script's `globalThis` is a proxy for the global object.
    if (auto* proxy = dynamicDowncast<JSGlobalProxy>(value))
        value = proxy->target();
    if (auto* globalObject = dynamicDowncast<JSDOMGlobalObject>(value)) {
        if (auto* window = dynamicDowncast<JSWindow>(globalObject->m_window.get()))
            return &window->wrapped();
    }
    return nullptr;
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionSetGlobalObjectWindow, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* window = dynamicDowncast<JSWindow>(callFrame->argument(0));
    if (auto* previous = dynamicDowncast<JSWindow>(globalObject->m_window.get()))
        previous->wrapped().setIsGlobalThis(false);
    if (window)
        window->wrapped().setIsGlobalThis(callFrame->argument(1).isTrue());
    globalObject->m_window.setMayBeNull(getVM(lexicalGlobalObject), globalObject, window);
    return JSValue::encode(jsUndefined());
}

static JSC_DECLARE_HOST_FUNCTION(jsFunctionRunAnimationFrameCallbacks);
JSC_DEFINE_HOST_FUNCTION(jsFunctionRunAnimationFrameCallbacks, (JSGlobalObject*, CallFrame* callFrame))
{
    uncheckedDowncast<JSWindow>(callFrame->uncheckedArgument(0))->wrapped().runAnimationFrameCallbacks();
    return JSValue::encode(jsUndefined());
}

// The timer holds the window's wrapper, so a window with a frame to come is not collected.
void scheduleAnimationFrame(Window& window, double delayInMilliseconds)
{
    auto* globalObject = uncheckedDowncast<JSDOMGlobalObject>(window.scriptExecutionContext()->globalObject());
    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* callback = JSFunction::create(vm, globalObject, 1, String(), jsFunctionRunAnimationFrameCallbacks, ImplementationVisibility::Private);
    Bun__Timer__setTimeout(globalObject, JSValue::encode(callback), JSValue::encode(wrap(globalObject, globalObject, window)), JSValue::encode(jsNumber(delayInMilliseconds)));
    (void)scope.tryClearException();
}

} // namespace WebCore
