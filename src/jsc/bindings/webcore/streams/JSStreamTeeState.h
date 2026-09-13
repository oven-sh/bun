// JSStreamTeeState — the shared per-tee() state cell for BOTH the default tee and the byte
// tee. It is the algorithmContext of both branch controllers (SourceKind::TeeBranch /
// ByteTeeBranch; the branch index lives on the controller). ReadableByteStreamTee is a
// DIFFERENT algorithm from the default tee — the two only share this state cell.
// Internal cell: no prototype, no constructor. Non-destructible.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSReadableStream.h"
#include <JavaScriptCore/JSInternalFieldObjectImpl.h>
#include <JavaScriptCore/JSPromise.h>

namespace WebCore {

class JSStreamTeeState final : public JSC::JSInternalFieldObjectImpl<7> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<7>;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    enum class Field : uint32_t {
        // The ORIGINAL stream — every cancel needs it.
        Stream = 0,
        // MUTABLE: the byte tee releases and re-acquires readers of EITHER kind repeatedly.
        // Erased to JSCell on purpose.
        Reader,
        // `branch1` / `branch2`
        Branch1,
        Branch2,
        // `cancelPromise`
        CancelPromise,
        // `reason1` / `reason2` — only meaningful once canceled1/canceled2 is set.
        Reason1,
        Reason2,
    };

    static JSStreamTeeState* create(JSC::VM&, JSC::Structure*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    static size_t allocationSize(Checked<size_t> inlineCapacity)
    {
        ASSERT_UNUSED(inlineCapacity, inlineCapacity == 0U);
        return sizeof(JSStreamTeeState);
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;
    static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);

    const JSC::WriteBarrier<JSC::Unknown>& internalField(Field field) const { return Base::internalField(static_cast<uint32_t>(field)); }
    JSC::WriteBarrier<JSC::Unknown>& internalField(Field field) { return Base::internalField(static_cast<uint32_t>(field)); }

    JSReadableStream* stream() const { return uncheckedDowncast<JSReadableStream>(fieldCell(Field::Stream)); }
    JSC::JSCell* reader() const { return fieldCell(Field::Reader); }
    JSReadableStream* branch1() const { return uncheckedDowncast<JSReadableStream>(fieldCell(Field::Branch1)); }
    JSReadableStream* branch2() const { return uncheckedDowncast<JSReadableStream>(fieldCell(Field::Branch2)); }
    JSC::JSPromise* cancelPromise() const { return uncheckedDowncast<JSC::JSPromise>(fieldCell(Field::CancelPromise)); }
    JSC::JSValue reason1() const { return internalField(Field::Reason1).get(); }
    JSC::JSValue reason2() const { return internalField(Field::Reason2).get(); }

    void setStream(JSC::VM& vm, JSReadableStream* stream) { internalField(Field::Stream).set(vm, this, stream); }
    void setReader(JSC::VM& vm, JSC::JSCell* reader) { internalField(Field::Reader).set(vm, this, reader); }
    void setBranch1(JSC::VM& vm, JSReadableStream* branch) { internalField(Field::Branch1).set(vm, this, branch); }
    void setBranch2(JSC::VM& vm, JSReadableStream* branch) { internalField(Field::Branch2).set(vm, this, branch); }
    void setCancelPromise(JSC::VM& vm, JSC::JSPromise* promise) { internalField(Field::CancelPromise).set(vm, this, promise); }
    void setReason1(JSC::VM& vm, JSC::JSValue reason) { internalField(Field::Reason1).set(vm, this, reason); }
    void setReason2(JSC::VM& vm, JSC::JSValue reason) { internalField(Field::Reason2).set(vm, this, reason); }

    // `reading`
    bool m_reading : 1 { false };
    // default tee: `readAgain`; byte tee: `readAgainForBranch1`. (One flag, two spec names.)
    bool m_readAgain1 : 1 { false };
    // byte tee only: `readAgainForBranch2`.
    bool m_readAgain2 : 1 { false };
    // `canceled1` / `canceled2`
    bool m_canceled1 : 1 { false };
    bool m_canceled2 : 1 { false };

private:
    JSStreamTeeState(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);

    JSC::JSCell* fieldCell(Field field) const
    {
        JSC::JSValue value = internalField(field).get();
        return value.isCell() ? value.asCell() : nullptr;
    }
};

} // namespace WebCore
