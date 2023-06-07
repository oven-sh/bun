#pragma once

#include "root.h"
#include <JavaScriptCore/InternalFunction.h>
#include "JavaScriptCore/SubspaceInlines.h"

namespace WebCore {
}

namespace Bun {

using namespace JSC;
using namespace WebCore;

class JSMockModule final {
public:
    LazyProperty<JSC::JSGlobalObject, Structure> mockFunctionStructure;
    LazyProperty<JSC::JSGlobalObject, Structure> mockResultStructure;
    LazyProperty<JSC::JSGlobalObject, Structure> mockImplementationStructure;
    LazyProperty<JSC::JSGlobalObject, Structure> mockObject;

    static JSMockModule create(JSC::JSGlobalObject*);

    DECLARE_VISIT_CHILDREN;
};

}