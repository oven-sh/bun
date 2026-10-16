#pragma once

#include "BunClientData.h"
#include "../V8PropertyCallbackInfo.h"

namespace v8 {
namespace shim {

// A data property recorded on a Template via Template::Set. `value` may be a
// primitive, an object, or another shim::FunctionTemplate / shim::ObjectTemplate
// (materialized when the template is instantiated).
struct TemplateProperty {
    JSC::WriteBarrier<JSC::Unknown> name;
    JSC::WriteBarrier<JSC::Unknown> value;
    unsigned attributes { 0 };
};

// A native-data accessor recorded on a Template via
// Template::SetNativeDataProperty.
struct TemplateAccessor {
    JSC::WriteBarrier<JSC::Unknown> name;
    JSC::WriteBarrier<JSC::Unknown> data;
    AccessorNameGetterCallback getter { nullptr };
    AccessorNameSetterCallback setter { nullptr };
    unsigned attributes { 0 };
};

// Install the recorded properties and native-data accessors of a template onto
// a JSC object (the prototype object from GetFunction, or an instance from
// ObjectTemplate::NewInstance).
void applyTemplateProperties(
    JSC::JSGlobalObject* globalObject,
    JSC::JSObject* target,
    const WTF::Vector<TemplateProperty>& properties,
    const WTF::Vector<TemplateAccessor>& accessors);

} // namespace shim
} // namespace v8
