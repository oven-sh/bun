#include "root.h"
#include "Bindgen/AdditionsToGlobalObject.h"
#include "GeneratedBindings+Classes.h"

namespace Bun::Bindgen {

void AdditionsToGlobalObject::initialize()
{
    Generated::initializeClasses(m_classes);
}

}
