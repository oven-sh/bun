#include "root.h"
#include "Bindgen/SchemaStrings.h"
#include "BunClientData.h"
#include "GeneratedBindings+Tables.h"
#include <JavaScriptCore/JSCInlines.h>

namespace Bun::Bindgen {
using namespace JSC;

SchemaStrings::SchemaStrings(VM& vm)
    : m_vm(vm)
    , m_memberNames(Tables::memberNames.size())
    , m_enumerationValues(WTF::FillWith {}, Tables::enumerationValues.size(), nullptr)
{
}

void SchemaStrings::initializeMemberNames(unsigned first, unsigned count)
{
    ASSERT(m_vm.currentThreadIsHoldingAPILock());
    for (unsigned i = first; i < first + count; ++i)
        m_memberNames[i] = Identifier::fromString(m_vm, Tables::memberNames[i]);
}

void SchemaStrings::initializeEnumerationValue(unsigned index)
{
    ASSERT(m_vm.currentThreadIsHoldingAPILock());
    m_enumerationValues[index] = jsString(m_vm, AtomString(Tables::enumerationValues[index]));
}

template<typename Visitor>
void SchemaStrings::visit(Visitor& visitor)
{
    for (auto* string : m_enumerationValues)
        visitor.appendUnbarriered(string);
}
template void SchemaStrings::visit(AbstractSlotVisitor&);
template void SchemaStrings::visit(SlotVisitor&);

SchemaStrings& schemaStrings(VM& vm)
{
    return static_cast<WebCore::JSVMClientData*>(vm.clientData)->schemaStrings;
}

}
