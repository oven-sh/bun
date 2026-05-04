#include "Handle.h"
#include "real_v8.h"

static_assert(offsetof(v8::shim::ObjectLayout, m_taggedMap) == real_v8::internal::Internals::kHeapObjectMapOffset,
    "ObjectLayout map pointer is at the wrong offset");
static_assert(offsetof(v8::shim::Handle, m_toV8Object) == 0,
    "Handle object pointer is at wrong offset");

namespace v8 {
namespace shim {

Handle::Handle(const Map* map, JSC::JSCell* cell, JSC::VM& vm, const JSC::JSCell* owner)
    : m_toV8Object(&this->m_object)
    , m_object(map, cell, vm, owner)
{
}

Handle::Handle(double number)
    : m_toV8Object(&this->m_object)
    , m_object(number)
{
}

Handle::Handle(int32_t smi)
    : m_toV8Object(smi)
    , m_object()
{
}

Handle::Handle(const Handle& that)
{
    *this = that;
}

Handle::Handle(const ObjectLayout* that)
    : m_toV8Object(&this->m_object)
{
    m_object = *that;
}

Handle& Handle::operator=(const Handle& that)
{
    m_object = that.m_object;
    if (that.m_toV8Object.tag() == TaggedPointer::Tag::Smi) {
        m_toV8Object = that.m_toV8Object;
    } else {
        m_toV8Object = &this->m_object;
    }
    return *this;
}

} // namespace shim
} // namespace v8
