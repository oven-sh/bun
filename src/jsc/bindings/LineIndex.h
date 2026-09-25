#pragma once

#include "root.h"

#include <atomic>
#include <span>
#include <wtf/Vector.h>
#include <wtf/text/StringView.h>

namespace Bun {

// Finds the line and the column of an offset from one checkpoint for each block of the text.
class LineIndex {
    WTF_MAKE_NONCOPYABLE(LineIndex);

public:
    LineIndex() = default;
    ~LineIndex();

    // Both results are zero-based. Any thread can call this. False when the text is not 8-bit.
    bool lineAndColumn(WTF::StringView text, unsigned offset, unsigned& line, unsigned& column);

    static constexpr unsigned blockShift = 10;
    static constexpr size_t blockSize = 1u << blockShift;

private:
    // What a scan knows when it has read every character before an offset.
    struct Checkpoint {
        unsigned line { 0 };
        unsigned lineStart { 0 };
    };

    struct Table {
        WTF_DEPRECATED_MAKE_STRUCT_FAST_ALLOCATED(Table);
        size_t length { 0 };
        bool hasCarriageReturn { false };
        WTF::Vector<Checkpoint> checkpoints;
    };

    static void scan(std::span<const Latin1Character> text, size_t begin, size_t end, bool hasCarriageReturn, Checkpoint&);
    static Table* build(std::span<const Latin1Character>);

    std::atomic<Table*> m_table { nullptr };
};

BUN_DECLARE_HOST_FUNCTION(Bun__lineIndexForTesting);
BUN_DECLARE_HOST_FUNCTION(Bun__lineStartTableIsBuiltForTesting);

} // namespace Bun
