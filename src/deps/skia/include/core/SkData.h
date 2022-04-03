/*
 * Copyright 2011 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkData_DEFINED
#define SkData_DEFINED

#include <stdio.h>

#include "include/core/SkRefCnt.h"

class SkStream;

/**
 *  SkData holds an immutable data buffer. Not only is the data immutable,
 *  but the actual ptr that is returned (by data() or bytes()) is guaranteed
 *  to always be the same for the life of this instance.
 */
class SK_API SkData final : public SkNVRefCnt<SkData> {
public:
    /**
     *  Returns the number of bytes stored.
     */
    size_t size() const { return fSize; }

    bool isEmpty() const { return 0 == fSize; }

    /**
     *  Returns the ptr to the data.
     */
    const void* data() const { return fPtr; }

    /**
     *  Like data(), returns a read-only ptr into the data, but in this case
     *  it is cast to uint8_t*, to make it easy to add an offset to it.
     */
    const uint8_t* bytes() const {
        return reinterpret_cast<const uint8_t*>(fPtr);
    }

    /**
     *  USE WITH CAUTION.
     *  This call will assert that the refcnt is 1, as a precaution against modifying the
     *  contents when another client/thread has access to the data.
     */
    void* writable_data() {
        if (fSize) {
            // only assert we're unique if we're not empty
            SkASSERT(this->unique());
        }
        return const_cast<void*>(fPtr);
    }

    /**
     *  Helper to copy a range of the data into a caller-provided buffer.
     *  Returns the actual number of bytes copied, after clamping offset and
     *  length to the size of the data. If buffer is NULL, it is ignored, and
     *  only the computed number of bytes is returned.
     */
    size_t copyRange(size_t offset, size_t length, void* buffer) const;

    /**
     *  Returns true if these two objects have the same length and contents,
     *  effectively returning 0 == memcmp(...)
     */
    bool equals(const SkData* other) const;

    /**
     *  Function that, if provided, will be called when the SkData goes out
     *  of scope, allowing for custom allocation/freeing of the data's contents.
     */
    typedef void (*ReleaseProc)(const void* ptr, void* context);

    /**
     *  Create a new dataref by copying the specified data
     */
    static sk_sp<SkData> MakeWithCopy(const void* data, size_t length);


    /**
     *  Create a new data with uninitialized contents. The caller should call writable_data()
     *  to write into the buffer, but this must be done before another ref() is made.
     */
    static sk_sp<SkData> MakeUninitialized(size_t length);

    /**
     *  Create a new data with zero-initialized contents. The caller should call writable_data()
     *  to write into the buffer, but this must be done before another ref() is made.
     */
    static sk_sp<SkData> MakeZeroInitialized(size_t length);

    /**
     *  Create a new dataref by copying the specified c-string
     *  (a null-terminated array of bytes). The returned SkData will have size()
     *  equal to strlen(cstr) + 1. If cstr is NULL, it will be treated the same
     *  as "".
     */
    static sk_sp<SkData> MakeWithCString(const char cstr[]);

    /**
     *  Create a new dataref, taking the ptr as is, and using the
     *  releaseproc to free it. The proc may be NULL.
     */
    static sk_sp<SkData> MakeWithProc(const void* ptr, size_t length, ReleaseProc proc, void* ctx);

    /**
     *  Call this when the data parameter is already const and will outlive the lifetime of the
     *  SkData. Suitable for with const globals.
     */
    static sk_sp<SkData> MakeWithoutCopy(const void* data, size_t length) {
        return MakeWithProc(data, length, NoopReleaseProc, nullptr);
    }

    /**
     *  Create a new dataref from a pointer allocated by malloc. The Data object
     *  takes ownership of that allocation, and will handling calling sk_free.
     */
    static sk_sp<SkData> MakeFromMalloc(const void* data, size_t length);

    /**
     *  Create a new dataref the file with the specified path.
     *  If the file cannot be opened, this returns NULL.
     */
    static sk_sp<SkData> MakeFromFileName(const char path[]);

    /**
     *  Create a new dataref from a stdio FILE.
     *  This does not take ownership of the FILE, nor close it.
     *  The caller is free to close the FILE at its convenience.
     *  The FILE must be open for reading only.
     *  Returns NULL on failure.
     */
    static sk_sp<SkData> MakeFromFILE(FILE* f);

    /**
     *  Create a new dataref from a file descriptor.
     *  This does not take ownership of the file descriptor, nor close it.
     *  The caller is free to close the file descriptor at its convenience.
     *  The file descriptor must be open for reading only.
     *  Returns NULL on failure.
     */
    static sk_sp<SkData> MakeFromFD(int fd);

    /**
     *  Attempt to read size bytes into a SkData. If the read succeeds, return the data,
     *  else return NULL. Either way the stream's cursor may have been changed as a result
     *  of calling read().
     */
    static sk_sp<SkData> MakeFromStream(SkStream*, size_t size);

    /**
     *  Create a new dataref using a subset of the data in the specified
     *  src dataref.
     */
    static sk_sp<SkData> MakeSubset(const SkData* src, size_t offset, size_t length);

    /**
     *  Returns a new empty dataref (or a reference to a shared empty dataref).
     *  New or shared, the caller must see that unref() is eventually called.
     */
    static sk_sp<SkData> MakeEmpty();

private:
    friend class SkNVRefCnt<SkData>;
    ReleaseProc fReleaseProc;
    void*       fReleaseProcContext;
    const void* fPtr;
    size_t      fSize;

    SkData(const void* ptr, size_t size, ReleaseProc, void* context);
    explicit SkData(size_t size);   // inplace new/delete
    ~SkData();

    // Ensure the unsized delete is called.
    void operator delete(void* p);

    // shared internal factory
    static sk_sp<SkData> PrivateNewWithCopy(const void* srcOrNull, size_t length);

    static void NoopReleaseProc(const void*, void*); // {}

    using INHERITED = SkRefCnt;
};

#endif
