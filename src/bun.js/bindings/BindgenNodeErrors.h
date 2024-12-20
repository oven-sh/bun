#pragma once
#include "root.h"

JSC::EncodedJSValue throwNodeInvalidArgTypeErrorForBindgen(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::ASCIILiteral& arg_name, const WTF::ASCIILiteral& expected_type, JSC::JSValue val_actual_value);
JSC::EncodedJSValue throwNodeInvalidArgValueErrorForBindgen(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, const WTF::ASCIILiteral& arg_name, const WTF::ASCIILiteral& expected_type, JSC::JSValue val_actual_value);
