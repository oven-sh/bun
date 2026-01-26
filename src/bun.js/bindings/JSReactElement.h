#pragma once
#include "root.h"
#include "headers.h"
#include "JavaScriptCore/JSObjectInlines.h"
#include "ZigGlobalObject.h"

using namespace JSC;

namespace Bun {
namespace JSReactElement {

Structure* createStructure(VM& vm, JSGlobalObject* globalObject);

} // namespace JSReactElement
} // namespace Bun

extern "C" JSC::EncodedJSValue JSReactElement__create(
    JSGlobalObject* globalObject,
    uint8_t reactVersion,
    EncodedJSValue type,
    EncodedJSValue props);
