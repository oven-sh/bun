#pragma once

// What _bz2 and _lzma share: two modules of the same shape over two libraries of the same shape.
//
// The libraries do their work without the GIL, as in CPython, so that other threads run meanwhile. What they touch then is none of
// the collector's: the state of the object, which is outside the heap; memory from LibraryMemory; the output, which is a
// BlockOutput; and the input, which is either a KeptInput or the memory of an object that a BufferHolder keeps as it is. Each
// object has a lock, held for the whole of a call, so that a second thread that uses the same object waits.

#include "BunPythonModule.h"

#include <JavaScriptCore/PyThreads.h>
#include <wtf/FastMalloc.h>

namespace Bun {
namespace PythonModules {

// What a library allocates for one object. It is asked with and without the GIL, but only ever by the thread that holds the lock
// of the object.
//
// The collector has to hear of this memory, or a program that drops compressors (94 MB each, for lzma as it is by default) has used
// up the machine before there is a collection. But most objects are used up, not dropped: after flush(), or at the end of the
// stream, the library is done and its memory is freed there and then. A collection for each of those would be for nothing. So the
// collector is told of the most that was ever held at once, less what it has freed itself: memory that replaces what the program
// gave back is no news to it. What it has not heard of is then never more than the program held at some time anyway.
class LibraryMemory {
    WTF_MAKE_NONCOPYABLE(LibraryMemory);

public:
    LibraryMemory() = default;

    // By then the library has freed everything. This is the collector's doing, if didFreeAll() has not been called.
    ~LibraryMemory()
    {
        if (!m_counted)
            return;
        Locker locker { s_lock };
        s_held -= m_counted;
        s_told -= m_counted;
    }

    void* allocate(size_t count, size_t size)
    {
        size_t bytes;
        if (__builtin_mul_overflow(count, size, &bytes))
            return nullptr;
        void* result;
        if (!tryFastMalloc(bytes).getValue(result))
            return nullptr;
        m_allocated += bytes;
        return result;
    }

    static void free(void* memory) { fastFree(memory); }

    // To be called, with the GIL, after the library may have allocated. (What it frees before the end is not taken off: that is
    // next to nothing.)
    void report(VM& vm)
    {
        if (m_allocated == m_counted)
            return;
        size_t news = 0;
        {
            Locker locker { s_lock };
            s_held += m_allocated - m_counted;
            if (s_held > s_told) {
                news = s_held - s_told;
                s_told = s_held;
            }
        }
        m_counted = m_allocated;
        if (news)
            vm.heap.deprecatedReportExtraMemory(news);
    }

    // The library has freed everything, because the program is done with the object.
    void didFreeAll()
    {
        if (m_counted) {
            Locker locker { s_lock };
            s_held -= m_counted;
        }
        m_counted = 0;
        m_allocated = 0;
    }

private:
    size_t m_allocated { 0 };
    size_t m_counted { 0 }; // How much of that is in s_held.

    // Of all objects, in all threads. s_told >= s_held.
    static inline Lock s_lock;
    static inline size_t s_held WTF_GUARDED_BY_LOCK(s_lock) { 0 };
    static inline size_t s_told WTF_GUARDED_BY_LOCK(s_lock) { 0 };
};

// What a stream writes to: blocks of memory, each as large as all before it together, that become a bytes in the end. Nothing is
// moved as it grows, and it may grow beyond what 32 bits count.
class BlockOutput {
    WTF_MAKE_NONCOPYABLE(BlockOutput);

public:
    // No more than `limit` bytes are ever made room for, if that is not negative.
    explicit BlockOutput(int64_t limit)
        : m_limit(limit)
    {
    }

    ~BlockOutput()
    {
        for (auto& block : m_blocks)
            fastFree(block.data());
    }

    // The part of the last block that has not been written to.
    std::span<uint8_t> room() const { return m_blocks.isEmpty() ? std::span<uint8_t>() : m_blocks.last().subspan(m_usedOfLast); }
    void didWrite(size_t count)
    {
        ASSERT(count <= room().size());
        m_usedOfLast += count;
        m_size += count;
    }

    size_t size() const { return m_size; }
    bool isAtLimit() const { return m_limit >= 0 && m_size == static_cast<uint64_t>(m_limit); }

    // There is no room left: makes some, unless the limit has been reached. False: there is no memory for it.
    bool grow()
    {
        ASSERT(room().empty());
        size_t size = std::clamp<size_t>(m_size, smallestBlock, largestBlock);
        if (m_limit >= 0)
            size = std::min<uint64_t>(size, static_cast<uint64_t>(m_limit) - m_size);
        if (!size)
            return true;
        void* memory;
        if (!tryFastMalloc(size).getValue(memory))
            return false;
        if (!m_blocks.tryAppend(std::span(static_cast<uint8_t*>(memory), size))) {
            fastFree(memory);
            return false;
        }
        m_usedOfLast = 0;
        return true;
    }

    // Empty: a MemoryError.
    JSValue finish(JSGlobalObject* globalObject) const
    {
        PyBytes* bytes = newBytes(globalObject, m_size);
        if (!bytes)
            return {};
        uint8_t* destination = bytes->mutableData();
        size_t left = m_size;
        for (auto& block : m_blocks) {
            size_t count = std::min(left, block.size());
            memcpy(destination, block.data(), count);
            destination += count;
            left -= count;
        }
        return bytes;
    }

private:
    static constexpr size_t smallestBlock = 32 * KB;
    static constexpr size_t largestBlock = 256 * MB; // libbzip2 counts what is left of a block in 32 bits.

    Vector<std::span<uint8_t>, 8> m_blocks;
    size_t m_usedOfLast { 0 };
    size_t m_size { 0 };
    int64_t m_limit;
};

// Input that a decompressor was given and has not got to, because there was a limit to its output.
class KeptInput {
    WTF_MAKE_NONCOPYABLE(KeptInput);

public:
    KeptInput() = default;
    ~KeptInput() { fastFree(m_memory); }

    bool isEmpty() const { return !m_size; }
    std::span<const uint8_t> span() const { return { m_memory + m_start, m_size }; }

    void clear()
    {
        m_start = 0;
        m_size = 0;
    }

    void removeFirst(size_t count)
    {
        ASSERT(count <= m_size);
        m_start += count;
        m_size -= count;
        if (!m_size)
            m_start = 0;
    }

    // False: there is no memory for it, and nothing has changed.
    bool append(std::span<const uint8_t> more)
    {
        if (more.empty())
            return true;
        size_t needed;
        if (__builtin_add_overflow(m_size, more.size(), &needed))
            return false;
        if (needed > m_capacity) {
            void* memory;
            if (!tryFastMalloc(needed).getValue(memory))
                return false;
            if (m_size)
                memcpy(memory, m_memory + m_start, m_size);
            fastFree(m_memory);
            m_memory = static_cast<uint8_t*>(memory);
            m_capacity = needed;
            m_start = 0;
        } else if (needed > m_capacity - m_start) {
            memmove(m_memory, m_memory + m_start, m_size);
            m_start = 0;
        }
        memcpy(m_memory + m_start + m_size, more.data(), more.size());
        m_size = needed;
        return true;
    }

private:
    uint8_t* m_memory { nullptr };
    size_t m_capacity { 0 };
    size_t m_start { 0 };
    size_t m_size { 0 };
};

// Holds the lock of an object for as long as it exists, unless it is false: then there is an exception, raised by the handler of
// a signal that came while it waited.
class ObjectLocker {
    WTF_MAKE_NONCOPYABLE(ObjectLocker);
    WTF_FORBID_HEAP_ALLOCATION;

public:
    ObjectLocker(JSGlobalObject* globalObject, ThreadLock& lock)
        : m_globalObject(globalObject)
        , m_lock(lock)
        , m_isHeld(lock.acquire(globalObject))
    {
    }

    ~ObjectLocker()
    {
        if (m_isHeld)
            m_lock.release(m_globalObject);
    }

    explicit operator bool() const { return m_isHeld; }

private:
    JSGlobalObject* m_globalObject;
    ThreadLock& m_lock;
    bool m_isHeld;
};

// ---- Decompressors ----
//
// decompress(data, max_length=-1), eof, needs_input, unused_data: an interface that bz2.BZ2Decompressor, lzma.LZMADecompressor,
// zlib._ZlibDecompressor and compression.zstd.ZstdDecompressor share, and that _compression.DecompressReader is written for.

struct DecompressorState {
    ThreadLock lock;
    LibraryMemory memory;
    KeptInput keptInput;
    bool isAtEnd { false };
    bool needsInput { true };
};

enum DecompressorField : unsigned {
    UnusedData,
    DecompressorFieldCount
};

// What a call of the library has come to. Other threads may look at the state of the object meanwhile, so this goes there when
// the GIL is held again.
struct DecompressionOutcome {
    bool isContent { true }; // The library, that is.
    bool hasMemoryForOutput { true };
    bool isAtEnd { false };
};

inline JSValue raiseNoMemoryForOutput(JSGlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    return raiseMemoryError(globalObject, scope, "Unable to allocate output buffer."_s);
}

// `run(input, output, outcome)`, which is called without the GIL, decompresses from the front of `input` and takes off it what it
// has consumed. `didRun()` is called afterwards, with the GIL. If the library is not content, `raise()` raises what it has to
// say. `mayHoldOutput`: the library may have more to give though it has taken all the input, if there was no room for it.
template<bool mayHoldOutput, typename Run, typename DidRun, typename Raise>
JSValue decompressWith(JSGlobalObject* globalObject, PyRecord* self, DecompressorState& state, std::span<const uint8_t> given, int64_t maxLength, const Run& run, const DidRun& didRun, const Raise& raise)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // What is left from last time goes first.
    bool readsKeptInput = !state.keptInput.isEmpty();
    if (readsKeptInput && !state.keptInput.append(given))
        return raiseMemoryError(globalObject, scope, String());
    std::span<const uint8_t> input = readsKeptInput ? state.keptInput.span() : given;
    size_t inputSize = input.size();

    BlockOutput output(maxLength < 0 ? -1 : maxLength);
    DecompressionOutcome outcome;
    {
        AllowThreads allowThreads(globalObject);
        run(input, output, outcome);
    }
    state.isAtEnd = outcome.isAtEnd;
    didRun();
    state.memory.report(vm);
    if (!outcome.isContent || !outcome.hasMemoryForOutput) {
        state.keptInput.clear();
        if (!outcome.isContent)
            RELEASE_AND_RETURN(scope, raise());
        RELEASE_AND_RETURN(scope, raiseNoMemoryForOutput(globalObject));
    }

    JSValue result = output.finish(globalObject);
    if (!result) {
        state.keptInput.clear();
        return {};
    }

    if (state.isAtEnd) {
        state.needsInput = false;
        if (!input.empty()) {
            JSValue unused = bytesFrom(globalObject, input);
            if (!unused) {
                state.keptInput.clear();
                return {};
            }
            self->set(vm, UnusedData, unused);
        }
        state.keptInput.clear();
    } else if (input.empty()) {
        state.keptInput.clear();
        state.needsInput = !(mayHoldOutput && output.isAtLimit());
    } else {
        state.needsInput = false;
        if (readsKeptInput)
            state.keptInput.removeFirst(inputSize - input.size());
        else if (!state.keptInput.append(input))
            return raiseMemoryError(globalObject, scope, String());
    }
    return result;
}

template<typename State>
JSValue decompressorEOF(JSGlobalObject*, JSValue self) { return jsBoolean(stateOf<State>(self)->isAtEnd); }

template<typename State>
JSValue decompressorNeedsInput(JSGlobalObject*, JSValue self) { return jsBoolean(stateOf<State>(self)->needsInput); }

inline JSValue decompressorUnusedData(JSGlobalObject*, JSValue self) { return uncheckedDowncast<PyRecord>(self.asCell())->get(UnusedData); }

} // namespace PythonModules
} // namespace Bun
