#pragma once

#include <JavaScriptCore/JSObject.h>

namespace WebCore {

// What CSSStyleProperties.prototype is made of.
// Every CSS property is an accessor on the prototype, under up to three names: "backgroundColor", "background-color", and both
// "WebkitMask" and "webkitMask". That is about 1,400 accessors, of which a program touches a few dozen. So an accessor is made when
// its name is looked up for the first time, and all of them are made when somebody wants the list. They all share one getter and
// one setter, which find the property from the name they are called with.
class JSCSSStylePropertiesPrototypeBase : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::OverridesGetOwnPropertyNames | JSC::OverridesGetOwnPropertySlot;

    DECLARE_INFO;

    static bool getOwnPropertySlot(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::PropertySlot&);
    static void getOwnPropertyNames(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyNameArrayBuilder&, JSC::DontEnumPropertiesMode);
    static bool deleteProperty(JSC::JSCell*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::DeletePropertySlot&);

    // True if it made the accessor.
    bool reifyPropertyIfNeeded(JSC::VM&, JSC::PropertyName);

protected:
    JSCSSStylePropertiesPrototypeBase(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

private:
    void reifyProperty(JSC::VM&, JSC::PropertyName);
    void reifyAllProperties(JSC::VM&);
};

} // namespace WebCore
