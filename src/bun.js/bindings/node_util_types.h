#include "JavaScriptCore/JSGlobalObject.h"
#include "ZigGlobalObject.h"

namespace Bun {
using namespace WebCore;

void generateNodeUtilTypesSourceCode(JSC::JSGlobalObject* lexicalGlobalObject,
    JSC::Identifier moduleKey,
    Vector<JSC::Identifier, 4>& exportNames,
    JSC::MarkedArgumentBuffer& exportValues);
}
