#include "napi.h"

namespace Zig {

NapiWeakValue::~NapiWeakValue()
{
    clear();
}

void NapiWeakValue::clear()
{
    switch (m_tag) {
    case WeakTypeTag::Cell: {
        m_value.cell.clear();
        break;
    }
    case WeakTypeTag::String: {
        m_value.string.clear();
        break;
    }
    default: {
        break;
    }
    }

    m_tag = WeakTypeTag::NotSet;
}

bool NapiWeakValue::isClear() const
{
    return m_tag == WeakTypeTag::NotSet;
}

void NapiWeakValue::setPrimitive(JSValue value)
{
    switch (m_tag) {
    case WeakTypeTag::Cell: {
        m_value.cell.clear();
        break;
    }
    case WeakTypeTag::String: {
        m_value.string.clear();
        break;
    }
    default: {
        break;
    }
    }
    m_tag = WeakTypeTag::Primitive;
    m_value.primitive = value;
}

void NapiWeakValue::set(JSValue value, WeakHandleOwner& owner, void* context)
{
    if (value.isCell()) {
        auto* cell = value.asCell();
        if (cell->isString()) {
            setString(jsCast<JSString*>(cell), owner, context);
        } else {
            setCell(cell, owner, context);
        }
    } else {
        setPrimitive(value);
    }
}

void NapiWeakValue::setCell(JSCell* cell, WeakHandleOwner& owner, void* context)
{
    switch (m_tag) {
    case WeakTypeTag::Cell: {
        m_value.cell.clear();
        break;
    }
    case WeakTypeTag::String: {
        m_value.string.clear();
        break;
    }
    default: {
        break;
    }
    }

    m_value.cell = JSC::Weak<JSCell>(cell, &owner, context);
    m_tag = WeakTypeTag::Cell;
}

void NapiWeakValue::setString(JSString* string, WeakHandleOwner& owner, void* context)
{
    switch (m_tag) {
    case WeakTypeTag::Cell: {
        m_value.cell.clear();
        break;
    }
    default: {
        break;
    }
    }

    m_value.string = JSC::Weak<JSString>(string, &owner, context);
    m_tag = WeakTypeTag::String;
}

}
