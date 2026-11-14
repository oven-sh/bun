#pragma once

#include <JavaScriptCore/ArgList.h>
#include <variant>
#include <wtf/HashMap.h>
#include <wtf/ThreadSafeRefCounted.h>
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>

namespace JSC {
class JSArray;
class JSGlobalObject;
class JSObject;
class VM;
}

namespace WebCore {

// What node:fs/promises keeps for a FileHandle in a transfer list: functions, by their place in the list.
enum class FileHandleTransferHook : uint8_t {
    Detach,
    Attach,
    Receive,
};

// That list if the object is a FileHandle, or null. It runs no code of the object.
JSC::JSArray* fileHandleTransferHooks(JSC::VM&, JSC::JSObject&);

struct TransferredFileHandle {
    int32_t fd { -1 };
    // A position of the message holds the handle: the receiving thread makes a FileHandle for no other.
    bool isReferenced { false };
    // The flag that the handle was opened with, if it is a number or a string.
    std::variant<std::monostate, double, String> flag;
};

// The descriptors of the FileHandles in the transfer list of a Worker, in transit to its thread. Carried alongside SerializedScriptValue, as TransferredMessagePort is.
class TransferredFileHandles final : public ThreadSafeRefCounted<TransferredFileHandles> {
public:
    static Ref<TransferredFileHandles> create(size_t count) { return adoptRef(*new TransferredFileHandles(count)); }
    // Closes each descriptor that is still here: no thread took it, and no handle got it back.
    ~TransferredFileHandles();

    Vector<TransferredFileHandle> slots;

private:
    explicit TransferredFileHandles(size_t count)
        : slots(count)
    {
    }
};

// The FileHandles of a transfer list, for the one caller that moves them: the Worker constructor of node:worker_threads. SerializedScriptValue::create() fills it.
struct FileHandleTransferList {
    JSC::MarkedArgumentBuffer handles;
    HashMap<JSC::JSObject*, unsigned> indexOf;
    // One slot for each handle, in the order of `handles`. Null where the transfer list has no FileHandle.
    RefPtr<TransferredFileHandles> descriptors;
};

// Gives the descriptor of each handle to its slot. Throws, with every descriptor back in its handle, where a handle is in use.
void detachFileHandlesForTransfer(JSC::JSGlobalObject&, const FileHandleTransferList&);
// Gives the descriptors back to the handles: no thread was started that would take them.
void reattachFileHandlesAfterTransfer(JSC::JSGlobalObject&, const FileHandleTransferList&);

} // namespace WebCore
