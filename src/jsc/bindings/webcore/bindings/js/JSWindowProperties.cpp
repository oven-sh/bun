#include "config.h"
#include "JSWindowProperties.h"

#include "DOMClientData.h"
#include "HTMLDocument.h"
#include "JSElement.h"
#include "JSEventTarget.h"
#include "JSHTMLCollection.h"
#include "JSWindow.h"
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/StructureCreateInlines.h>
#include <wtf/SetForScope.h>

namespace WebCore {
using namespace JSC;

const ClassInfo JSWindowProperties::s_info = { "WindowProperties"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWindowProperties) };

JSWindowProperties* JSWindowProperties::create(VM& vm, JSDOMGlobalObject& globalObject)
{
    auto* structure = Structure::create(vm, &globalObject, JSEventTarget::prototype(vm, globalObject), TypeInfo(ObjectType, StructureFlags), info(), NonArray);
    structure->setMayBePrototype(true);
    auto* object = new (NotNull, allocateCell<JSWindowProperties>(vm)) JSWindowProperties(vm, structure);
    object->finishCreation(vm);
    return object;
}

void JSWindowProperties::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// https://html.spec.whatwg.org/multipage/window-object.html#dom-window-nameditem
static JSValue namedItem(JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, JSValue receiver, PropertyName propertyName)
{
    // All windows of a realm share this object. The one that is meant is the receiver, or else the one the global object stands for.
    RefPtr window = JSWindow::toWrapped(getVM(&lexicalGlobalObject), receiver);
    if (!window)
        window = JSWindow::toWrapped(getVM(&lexicalGlobalObject), &globalObject);
    RefPtr document = window ? dynamicDowncast<HTMLDocument>(window->document()) : nullptr;
    AtomString name = propertyName.publicName();
    if (!document || name.isEmpty())
        return { };
    if (RefPtr frameWindow = window->namedItem(name))
        return toJS(&lexicalGlobalObject, &globalObject, *frameWindow);
    if (!document->hasWindowNamedItem(name))
        return { };
    if (document->windowNamedItemContainsMultipleElements(name)) [[unlikely]]
        return toJS(&lexicalGlobalObject, &globalObject, document->windowNamedItems(name));
    return toJS(&lexicalGlobalObject, &globalObject, *document->windowNamedItem(name));
}

bool JSWindowProperties::getOwnPropertySlot(JSObject* object, JSGlobalObject* lexicalGlobalObject, PropertyName propertyName, PropertySlot& slot)
{
    VM& vm = getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (Base::getOwnPropertySlot(object, lexicalGlobalObject, propertyName, slot))
        return true;
    // Reading the global object can run a getter, which an inquiry must not do.
    if (propertyName.isSymbol() || slot.isVMInquiry())
        return false;

    bool isInherited = asObject(object->getPrototypeDirect())->hasProperty(lexicalGlobalObject, propertyName);
    RETURN_IF_EXCEPTION(scope, false);
    if (isInherited)
        return false;

    // Only the global object's own properties: its prototype chain could lead back here.
    JSGlobalObject* globalObject = object->globalObject();
    PropertySlot globalSlot(globalObject->globalThis(), PropertySlot::InternalMethodType::Get);
    bool found = globalObject->methodTable()->getOwnPropertySlot(globalObject, lexicalGlobalObject, propertyName, globalSlot);
    RETURN_IF_EXCEPTION(scope, false);
    if (!found) {
        JSValue item = namedItem(*lexicalGlobalObject, *uncheckedDowncast<JSDOMGlobalObject>(globalObject), slot.thisValue(), propertyName);
        if (item)
            slot.setValue(object, static_cast<unsigned>(PropertyAttribute::DontEnum), item);
        return !!item;
    }

    JSValue value = jsUndefined();
    if (slot.internalMethodType() != PropertySlot::InternalMethodType::HasProperty) {
        // Test environments give the global object getters that read the same name from a window. The window does not have it then.
        auto& innermostRead = domClientData(vm).windowGlobalObjectRead();
        for (auto* read = innermostRead; read; read = read->outer) {
            if (read->name == propertyName.uid())
                return false;
        }
        WindowGlobalObjectRead read { propertyName.uid(), innermostRead };
        SetForScope readScope(innermostRead, &read);
        value = globalSlot.getValue(lexicalGlobalObject, propertyName);
        RETURN_IF_EXCEPTION(scope, false);
    } else
        slot.setIsTaintedByOpaqueObject(); // The slot has no value to read, as a Proxy's has none. spyOn() goes by this.
    slot.setValue(object, static_cast<unsigned>(PropertyAttribute::DontEnum), value);
    return true;
}

} // namespace WebCore
