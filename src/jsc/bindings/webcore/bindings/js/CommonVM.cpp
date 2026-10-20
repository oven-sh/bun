#include "config.h"
#include "CommonVM.h"

#include "ZigGlobalObject.h"
#include <JavaScriptCore/VM.h>
#include <wtf/text/AtomString.h>

namespace WebCore {

JSC::VM& commonVM()
{
    return defaultGlobalObject()->vm();
}

void addImpureProperty(const AtomString& propertyName)
{
    commonVM().addImpureProperty(propertyName.impl());
}

} // namespace WebCore
