/*
 * Copyright 2006 The Android Open Source Project
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkStream_DEFINED
#define SkStream_DEFINED

#include "include/core/SkData.h"
#include "include/core/SkRefCnt.h"
#include "include/core/SkScalar.h"
#include "include/private/SkTo.h"

#include <memory.h>

class SkStream;
class SkStreamRewindable;
class SkStreamSeekable;
class SkStreamAsset;
class SkStreamMemory;

/**
 *  SkStream -- abstraction for a source of bytes. Subclasses can be backed by
 *  memory, or a file, or something else.
 *
 *  NOTE:
 *
 *  Classic "streams" APIs are sort of async, in that on a request for N
 *  bytes, they may return fewer than N bytes on a given call, in which case
 *  the caller can "try again" to get more bytes, eventually (modulo an error)
 *  receiving their total N bytes.
 *
 *  Skia streams behave differently. They are effectively synchronous, and will
 *  always return all N bytes of the request if possible. If they return fewer
 *  (the read() call returns the number of bytes read) then that means there is
 *  no more data (at EOF or hit an error). The caller should *not* call again
 *  in hopes of fulfilling more of the request.
 */
class SK_API SkStream {
public:
    virtual ~SkStream() {}
    SkStream() {}

    /**
     *  Attempts to open the specified file as a stream, returns nullptr on failure.
     */
    static std::unique_ptr<SkStreamAsset> MakeFromFile(const char path[]);

    /** Reads or skips size number of bytes.
     *  If buffer == NULL, skip size bytes, return how many were skipped.
     *  If buffer != NULL, copy size bytes into buffer, return how many were copied.
     *  @param buffer when NULL skip size bytes, otherwise copy size bytes into buffer
     *  @param size the number of bytes to skip or copy
     *  @return the number of bytes actually read.
     */
    virtual size_t read(void* buffer, size_t size) = 0;

    /** Skip size number of bytes.
     *  @return the actual number bytes that could be skipped.
     */
    size_t skip(size_t size) {
        return this->read(nullptr, size);
    }

    /**
     *  Attempt to peek at size bytes.
     *  If this stream supports peeking, copy min(size, peekable bytes) into
     *  buffer, and return the number of bytes copied.
     *  If the stream does not support peeking, or cannot peek any bytes,
     *  return 0 and leave buffer unchanged.
     *  The stream is guaranteed to be in the same visible state after this
     *  call, regardless of success or failure.
     *  @param buffer Must not be NULL, and must be at least size bytes. Destination
     *      to copy bytes.
     *  @param size Number of bytes to copy.
     *  @return The number of bytes peeked/copied.
     */
    virtual size_t peek(void* /*buffer*/, size_t /*size*/) const { return 0; }

    /** Returns true when all the bytes in the stream have been read.
     *  This may return true early (when there are no more bytes to be read)
     *  or late (after the first unsuccessful read).
     */
    virtual bool isAtEnd() const = 0;

    bool SK_WARN_UNUSED_RESULT readS8(int8_t*);
    bool SK_WARN_UNUSED_RESULT readS16(int16_t*);
    bool SK_WARN_UNUSED_RESULT readS32(int32_t*);

    bool SK_WARN_UNUSED_RESULT readU8(uint8_t* i) { return this->readS8((int8_t*)i); }
    bool SK_WARN_UNUSED_RESULT readU16(uint16_t* i) { return this->readS16((int16_t*)i); }
    bool SK_WARN_UNUSED_RESULT readU32(uint32_t* i) { return this->readS32((int32_t*)i); }

    bool SK_WARN_UNUSED_RESULT readBool(bool* b) {
        uint8_t i;
        if (!this->readU8(&i)) { return false; }
        *b = (i != 0);
        return true;
    }
    bool SK_WARN_UNUSED_RESULT readScalar(SkScalar*);
    bool SK_WARN_UNUSED_RESULT readPackedUInt(size_t*);

//SkStreamRewindable
    /** Rewinds to the beginning of the stream. Returns true if the stream is known
     *  to be at the beginning after this call returns.
     */
    virtual bool rewind() { return false; }

    /** Duplicates this stream. If this cannot be done, returns NULL.
     *  The returned stream will be positioned at the beginning of its data.
     */
    std::unique_ptr<SkStream> duplicate() const {
        return std::unique_ptr<SkStream>(this->onDuplicate());
    }
    /** Duplicates this stream. If this cannot be done, returns NULL.
     *  The returned stream will be positioned the same as this stream.
     */
    std::unique_ptr<SkStream> fork() const {
        return std::unique_ptr<SkStream>(this->onFork());
    }

//SkStreamSeekable
    /** Returns true if this stream can report it's current position. */
    virtual bool hasPosition() const { return false; }
    /** Returns the current position in the stream. If this cannot be done, returns 0. */
    virtual size_t getPosition() const { return 0; }

    /** Seeks to an absolute position in the stream. If this cannot be done, returns false.
     *  If an attempt is made to seek past the end of the stream, the position will be set
     *  to the end of the stream.
     */
    virtual bool seek(size_t /*position*/) { return false; }

    /** Seeks to an relative offset in the stream. If this cannot be done, returns false.
     *  If an attempt is made to move to a position outside the stream, the position will be set
     *  to the closest point within the stream (beginning or end).
     */
    virtual bool move(long /*offset*/) { return false; }

//SkStreamAsset
    /** Returns true if this stream can report it's total length. */
    virtual bool hasLength() const { return false; }
    /** Returns the total length of the stream. If this cannot be done, returns 0. */
    virtual size_t getLength() const { return 0; }

//SkStreamMemory
    /** Returns the starting address for the data. If this cannot be done, returns NULL. */
    //TODO: replace with virtual const SkData* getData()
    virtual const void* getMemoryBase() { return nullptr; }

private:
    virtual SkStream* onDuplicate() const { return nullptr; }
    virtual SkStream* onFork() const { return nullptr; }

    SkStream(SkStream&&) = delete;
    SkStream(const SkStream&) = delete;
    SkStream& operator=(SkStream&&) = delete;
    SkStream& operator=(const SkStream&) = delete;
};

/** SkStreamRewindable is a SkStream for which rewind and duplicate are required. */
class SK_API SkStreamRewindable : public SkStream {
public:
    bool rewind() override = 0;
    std::unique_ptr<SkStreamRewindable> duplicate() const {
        return std::unique_ptr<SkStreamRewindable>(this->onDuplicate());
    }
private:
    SkStreamRewindable* onDuplicate() const override = 0;
};

/** SkStreamSeekable is a SkStreamRewindable for which position, seek, move, and fork are required. */
class SK_API SkStreamSeekable : public SkStreamRewindable {
public:
    std::unique_ptr<SkStreamSeekable> duplicate() const {
        return std::unique_ptr<SkStreamSeekable>(this->onDuplicate());
    }

    bool hasPosition() const override { return true; }
    size_t getPosition() const override = 0;
    bool seek(size_t position) override = 0;
    bool move(long offset) override = 0;

    std::unique_ptr<SkStreamSeekable> fork() const {
        return std::unique_ptr<SkStreamSeekable>(this->onFork());
    }
private:
    SkStreamSeekable* onDuplicate() const override = 0;
    SkStreamSeekable* onFork() const override = 0;
};

/** SkStreamAsset is a SkStreamSeekable for which getLength is required. */
class SK_API SkStreamAsset : public SkStreamSeekable {
public:
    bool hasLength() const override { return true; }
    size_t getLength() const override = 0;

    std::unique_ptr<SkStreamAsset> duplicate() const {
        return std::unique_ptr<SkStreamAsset>(this->onDuplicate());
    }
    std::unique_ptr<SkStreamAsset> fork() const {
        return std::unique_ptr<SkStreamAsset>(this->onFork());
    }
private:
    SkStreamAsset* onDuplicate() const override = 0;
    SkStreamAsset* onFork() const override = 0;
};

/** SkStreamMemory is a SkStreamAsset for which getMemoryBase is required. */
class SK_API SkStreamMemory : public SkStreamAsset {
public:
    const void* getMemoryBase() override = 0;

    std::unique_ptr<SkStreamMemory> duplicate() const {
        return std::unique_ptr<SkStreamMemory>(this->onDuplicate());
    }
    std::unique_ptr<SkStreamMemory> fork() const {
        return std::unique_ptr<SkStreamMemory>(this->onFork());
    }
private:
    SkStreamMemory* onDuplicate() const override = 0;
    SkStreamMemory* onFork() const override = 0;
};

class SK_API SkWStream {
public:
    virtual ~SkWStream();
    SkWStream() {}

    /** Called to write bytes to a SkWStream. Returns true on success
        @param buffer the address of at least size bytes to be written to the stream
        @param size The number of bytes in buffer to write to the stream
        @return true on success
    */
    virtual bool write(const void* buffer, size_t size) = 0;
    virtual void flush();

    virtual size_t bytesWritten() const = 0;

    // helpers

    bool write8(U8CPU value)   {
        uint8_t v = SkToU8(value);
        return this->write(&v, 1);
    }
    bool write16(U16CPU value) {
        uint16_t v = SkToU16(value);
        return this->write(&v, 2);
    }
    bool write32(uint32_t v) {
        return this->write(&v, 4);
    }

    bool writeText(const char text[]) {
        SkASSERT(text);
        return this->write(text, strlen(text));
    }

    bool newline() { return this->write("\n", strlen("\n")); }

    bool writeDecAsText(int32_t);
    bool writeBigDecAsText(int64_t, int minDigits = 0);
    bool writeHexAsText(uint32_t, int minDigits = 0);
    bool writeScalarAsText(SkScalar);

    bool writeBool(bool v) { return this->write8(v); }
    bool writeScalar(SkScalar);
    bool writePackedUInt(size_t);

    bool writeStream(SkStream* input, size_t length);

    /**
     * This returns the number of bytes in the stream required to store
     * 'value'.
     */
    static int SizeOfPackedUInt(size_t value);

private:
    SkWStream(const SkWStream&) = delete;
    SkWStream& operator=(const SkWStream&) = delete;
};

class SK_API SkNullWStream : public SkWStream {
public:
    SkNullWStream() : fBytesWritten(0) {}

    bool write(const void* , size_t n) override { fBytesWritten += n; return true; }
    void flush() override {}
    size_t bytesWritten() const override { return fBytesWritten; }

private:
    size_t fBytesWritten;
};

////////////////////////////////////////////////////////////////////////////////////////

#include <stdio.h>

/** A stream that wraps a C FILE* file stream. */
class SK_API SkFILEStream : public SkStreamAsset {
public:
    /** Initialize the stream by calling sk_fopen on the specified path.
     *  This internal stream will be closed in the destructor.
     */
    explicit SkFILEStream(const char path[] = nullptr);

    /** Initialize the stream with an existing C FILE stream.
     *  The current position of the C FILE stream will be considered the
     *  beginning of the SkFILEStream and the current seek end of the FILE will be the end.
     *  The C FILE stream will be closed in the destructor.
     */
    explicit SkFILEStream(FILE* file);

    /** Initialize the stream with an existing C FILE stream.
     *  The current position of the C FILE stream will be considered the
     *  beginning of the SkFILEStream and size bytes later will be the end.
     *  The C FILE stream will be closed in the destructor.
     */
    explicit SkFILEStream(FILE* file, size_t size);

    ~SkFILEStream() override;

    static std::unique_ptr<SkFILEStream> Make(const char path[]) {
        std::unique_ptr<SkFILEStream> stream(new SkFILEStream(path));
        return stream->isValid() ? std::move(stream) : nullptr;
    }

    /** Returns true if the current path could be opened. */
    bool isValid() const { return fFILE != nullptr; }

    /** Close this SkFILEStream. */
    void close();

    size_t read(void* buffer, size_t size) override;
    bool isAtEnd() const override;

    bool rewind() override;
    std::unique_ptr<SkStreamAsset> duplicate() const {
        return std::unique_ptr<SkStreamAsset>(this->onDuplicate());
    }

    size_t getPosition() const override;
    bool seek(size_t position) override;
    bool move(long offset) override;

    std::unique_ptr<SkStreamAsset> fork() const {
        return std::unique_ptr<SkStreamAsset>(this->onFork());
    }

    size_t getLength() const override;

private:
    explicit SkFILEStream(FILE*, size_t size, size_t start);
    explicit SkFILEStream(std::shared_ptr<FILE>, size_t end, size_t start);
    explicit SkFILEStream(std::shared_ptr<FILE>, size_t end, size_t start, size_t current);

    SkStreamAsset* onDuplicate() const override;
    SkStreamAsset* onFork() const override;

    std::shared_ptr<FILE> fFILE;
    // My own council will I keep on sizes and offsets.
    // These are seek positions in the underling FILE, not offsets into the stream.
    size_t fEnd;
    size_t fStart;
    size_t fCurrent;

    using INHERITED = SkStreamAsset;
};

class SK_API SkMemoryStream : public SkStreamMemory {
public:
    SkMemoryStream();

    /** We allocate (and free) the memory. Write to it via getMemoryBase() */
    SkMemoryStream(size_t length);

    /** If copyData is true, the stream makes a private copy of the data. */
    SkMemoryStream(const void* data, size_t length, bool copyData = false);

    /** Creates the stream to read from the specified data */
    SkMemoryStream(sk_sp<SkData> data);

    /** Returns a stream with a copy of the input data. */
    static std::unique_ptr<SkMemoryStream> MakeCopy(const void* data, size_t length);

    /** Returns a stream with a bare pointer reference to the input data. */
    static std::unique_ptr<SkMemoryStream> MakeDirect(const void* data, size_t length);

    /** Returns a stream with a shared reference to the input data. */
    static std::unique_ptr<SkMemoryStream> Make(sk_sp<SkData> data);

    /** Resets the stream to the specified data and length,
        just like the constructor.
        if copyData is true, the stream makes a private copy of the data
    */
    virtual void setMemory(const void* data, size_t length,
                           bool copyData = false);
    /** Replace any memory buffer with the specified buffer. The caller
        must have allocated data with sk_malloc or sk_realloc, since it
        will be freed with sk_free.
    */
    void setMemoryOwned(const void* data, size_t length);

    sk_sp<SkData> asData() const { return fData; }
    void setData(sk_sp<SkData> data);

    void skipToAlign4();
    const void* getAtPos();

    size_t read(void* buffer, size_t size) override;
    bool isAtEnd() const override;

    size_t peek(void* buffer, size_t size) const override;

    bool rewind() override;

    std::unique_ptr<SkMemoryStream> duplicate() const {
        return std::unique_ptr<SkMemoryStream>(this->onDuplicate());
    }

    size_t getPosition() const override;
    bool seek(size_t position) override;
    bool move(long offset) override;

    std::unique_ptr<SkMemoryStream> fork() const {
        return std::unique_ptr<SkMemoryStream>(this->onFork());
    }

    size_t getLength() const override;

    const void* getMemoryBase() override;

private:
    SkMemoryStream* onDuplicate() const override;
    SkMemoryStream* onFork() const override;

    sk_sp<SkData>   fData;
    size_t          fOffset;

    using INHERITED = SkStreamMemory;
};

/////////////////////////////////////////////////////////////////////////////////////////////

class SK_API SkFILEWStream : public SkWStream {
public:
    SkFILEWStream(const char path[]);
    ~SkFILEWStream() override;

    /** Returns true if the current path could be opened.
    */
    bool isValid() const { return fFILE != nullptr; }

    bool write(const void* buffer, size_t size) override;
    void flush() override;
    void fsync();
    size_t bytesWritten() const override;

private:
    FILE* fFILE;

    using INHERITED = SkWStream;
};

class SK_API SkDynamicMemoryWStream : public SkWStream {
public:
    SkDynamicMemoryWStream() = default;
    SkDynamicMemoryWStream(SkDynamicMemoryWStream&&);
    SkDynamicMemoryWStream& operator=(SkDynamicMemoryWStream&&);
    ~SkDynamicMemoryWStream() override;

    bool write(const void* buffer, size_t size) override;
    size_t bytesWritten() const override;

    bool read(void* buffer, size_t offset, size_t size);

    /** More efficient version of read(dst, 0, bytesWritten()). */
    void copyTo(void* dst) const;
    bool writeToStream(SkWStream* dst) const;

    /** Equivalent to copyTo() followed by reset(), but may save memory use. */
    void copyToAndReset(void* dst);

    /** Equivalent to writeToStream() followed by reset(), but may save memory use. */
    bool writeToAndReset(SkWStream* dst);

    /** Equivalent to writeToStream() followed by reset(), but may save memory use.
        When the dst is also a SkDynamicMemoryWStream, the implementation is constant time. */
    bool writeToAndReset(SkDynamicMemoryWStream* dst);

    /** Prepend this stream to dst, resetting this. */
    void prependToAndReset(SkDynamicMemoryWStream* dst);

    /** Return the contents as SkData, and then reset the stream. */
    sk_sp<SkData> detachAsData();

    /** Reset, returning a reader stream with the current content. */
    std::unique_ptr<SkStreamAsset> detachAsStream();

    /** Reset the stream to its original, empty, state. */
    void reset();
    void padToAlign4();
private:
    struct Block;
    Block*  fHead = nullptr;
    Block*  fTail = nullptr;
    size_t  fBytesWrittenBeforeTail = 0;

#ifdef SK_DEBUG
    void validate() const;
#else
    void validate() const {}
#endif

    // For access to the Block type.
    friend class SkBlockMemoryStream;
    friend class SkBlockMemoryRefCnt;

    using INHERITED = SkWStream;
};

#endif
