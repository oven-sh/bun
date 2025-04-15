#include "lldbhalp.h"

namespace Bun {

// ok for x86_64 and aarch64
struct FrameEntry {
    FrameEntry* next;
    void (*return_address)();
};

void (*get_trace_entry_at(void* frame_pointer, int idx))()
{
    if (!frame_pointer) return nullptr;
    auto* entry = reinterpret_cast<FrameEntry*>(frame_pointer);
    for (int i = 0; i < idx; i++) {
        entry = entry->next;
    }
    return entry->return_address;
}

} // namespace Bun
