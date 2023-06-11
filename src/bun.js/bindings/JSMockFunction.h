#pragma once

#include "root.h"
#include "JavaScriptCore/LazyProperty.h"
#include "JavaScriptCore/Strong.h"

namespace WebCore {
}

namespace Bun {

using namespace JSC;
using namespace WebCore;

class JSMockFunction;

class JSMockModule final {
public:
    LazyProperty<JSC::JSGlobalObject, Structure> mockFunctionStructure;
    LazyProperty<JSC::JSGlobalObject, Structure> mockResultStructure;
    LazyProperty<JSC::JSGlobalObject, Structure> mockImplementationStructure;
    LazyProperty<JSC::JSGlobalObject, Structure> mockObjectStructure;
    LazyProperty<JSC::JSGlobalObject, Structure> activeSpySetStructure;

    static JSMockModule create(JSC::JSGlobalObject*);

    JSC::Strong<Unknown> activeSpies;
};

}