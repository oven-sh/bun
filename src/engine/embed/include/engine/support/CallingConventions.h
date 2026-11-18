#pragma once

#include "engine/support/Platform.h"

#define JSC_HOST_CALL_ATTRIBUTES SYSV_ABI
#define JIT_OPERATION_ATTRIBUTES SYSV_ABI

#define JSC_ANNOTATE_HOST_FUNCTION(identifier, function)

#define JSC_DECLARE_HOST_FUNCTION(name) \
    JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES name(JSC::JSGlobalObject*, JSC::CallFrame*)
#define JSC_DEFINE_HOST_FUNCTION_WITH_ATTRIBUTES(name, attributes, parameters) \
    attributes JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES name parameters
#define JSC_DEFINE_HOST_FUNCTION(name, parameters) JSC_DEFINE_HOST_FUNCTION_WITH_ATTRIBUTES(name, , parameters)

#define JSC_DECLARE_CUSTOM_GETTER(name) \
    JSC::EncodedJSValue JIT_OPERATION_ATTRIBUTES name(JSC::JSGlobalObject*, JSC::EncodedJSValue, JSC::PropertyName)
#define JSC_DECLARE_CUSTOM_SETTER(name) \
    bool JIT_OPERATION_ATTRIBUTES name(JSC::JSGlobalObject*, JSC::EncodedJSValue, JSC::EncodedJSValue, JSC::PropertyName)
#define JSC_DEFINE_CUSTOM_GETTER(name, parameters) JSC::EncodedJSValue JIT_OPERATION_ATTRIBUTES name parameters
#define JSC_DEFINE_CUSTOM_SETTER(name, parameters) bool JIT_OPERATION_ATTRIBUTES name parameters
