#pragma once

#include "BunClientData.h"
#include "root.h"
#include "napi.h"

namespace Bun {

// An object used to store the 128-bit type UUID provided by a native module in napi_type_tag_object.
// This is a JSCell because we store it in a weak map
class NapiTypeTag : public JSC::JSCell {
public:
    using Base = JSC::JSCell;

    static NapiTypeTag* create(
        JSC::VM& vm,
        JSC::Structure* structure,
        const napi_type_tag& tag);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        return JSC::Structure::create(vm, globalObject, JSC::jsNull(), JSC::TypeInfo(JSC::CellType, StructureFlags), info(), 0, 0);
    }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<NapiTypeTag, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForNapiTypeTag.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForNapiTypeTag = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForNapiTypeTag.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForNapiTypeTag = std::forward<decltype(space)>(space); });
    }

    DECLARE_INFO;

    // Returns true if this tag is the same as the other tag
    bool matches(const napi_type_tag& other) const
    {
        return m_tag.lower == other.lower && m_tag.upper == other.upper;
    }

private:
    NapiTypeTag(JSC::VM& vm, JSC::Structure* structure, const napi_type_tag& tag)
        : Base(vm, structure)
        , m_tag(tag)
    {
    }

    napi_type_tag m_tag;
};

} // namespace Bun
