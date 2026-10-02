#pragma once

#include "root.h"
#include <wtf/Vector.h>

namespace Bun {

enum class Claim : uint8_t {
    Missed, // nothing claimed (also returned when `matches` threw; check the scope first)
    Claimed,
    Exhausted, // claimed the last open entry
};

// One side's entries still needing a counterpart, claimed one at a time while the other side is walked. Plain copies: the caller roots them.
template<typename Entry>
struct PendingEntries {
    using Queue = WTF::Vector<Entry, 8>;

    Queue entries;
    size_t first { 0 };
    size_t end;
    // Node's guess: keep probing the end that hit last, so same-order and reversed inputs stay linear.
    bool probeFront { true };

    explicit PendingEntries(Queue&& queued)
        : entries(std::move(queued))
        , end(entries.size())
    {
        ASSERT(end);
    }

    size_t openCount() const { return end - first; }

    // What a walk leaves behind for an entry known to match nothing, without running the probes.
    void recordMiss() { probeFront = true; }

    // Probe order of node's partialObject{Set,Map}Equiv: front guess, back guess, then the rest back to front.
    template<typename Matches>
    Claim claimWith(JSC::ThrowScope& scope, const Matches& matches)
    {
        ASSERT(first < end);
        size_t scanFrom = first;
        if (probeFront) {
            bool hit = matches(entries[first]);
            RETURN_IF_EXCEPTION(scope, Claim::Missed);
            if (hit) {
                first++;
                return first == end ? Claim::Exhausted : Claim::Claimed;
            }
            if (openCount() == 1)
                return Claim::Missed;
            probeFront = false;
            scanFrom++;
        }
        size_t i = end - 1;
        bool hit = matches(entries[i]);
        RETURN_IF_EXCEPTION(scope, Claim::Missed);
        if (!hit) {
            probeFront = true;
            while (!hit && i > scanFrom) {
                i--;
                hit = matches(entries[i]);
                RETURN_IF_EXCEPTION(scope, Claim::Missed);
            }
            if (!hit)
                return Claim::Missed;
            entries[i] = entries[end - 1];
        }
        end--;
        return first == end ? Claim::Exhausted : Claim::Claimed;
    }
};

} // namespace Bun
