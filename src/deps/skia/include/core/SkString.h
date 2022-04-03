/*
 * Copyright 2006 The Android Open Source Project
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkString_DEFINED
#define SkString_DEFINED

#include "include/core/SkRefCnt.h"
#include "include/core/SkScalar.h"
#include "include/core/SkTypes.h"
#include "include/private/SkMalloc.h"
#include "include/private/SkTArray.h"
#include "include/private/SkTo.h"

#include <stdarg.h>
#include <string.h>
#include <atomic>
#include <string>

namespace skstd {
    class string_view;
}

/*  Some helper functions for C strings */
static inline bool SkStrStartsWith(const char string[], const char prefixStr[]) {
    SkASSERT(string);
    SkASSERT(prefixStr);
    return !strncmp(string, prefixStr, strlen(prefixStr));
}
static inline bool SkStrStartsWith(const char string[], const char prefixChar) {
    SkASSERT(string);
    return (prefixChar == *string);
}

bool SkStrEndsWith(const char string[], const char suffixStr[]);
bool SkStrEndsWith(const char string[], const char suffixChar);

int SkStrStartsWithOneOf(const char string[], const char prefixes[]);

static inline int SkStrFind(const char string[], const char substring[]) {
    const char *first = strstr(string, substring);
    if (nullptr == first) return -1;
    return SkToInt(first - &string[0]);
}

static inline int SkStrFindLastOf(const char string[], const char subchar) {
    const char* last = strrchr(string, subchar);
    if (nullptr == last) return -1;
    return SkToInt(last - &string[0]);
}

static inline bool SkStrContains(const char string[], const char substring[]) {
    SkASSERT(string);
    SkASSERT(substring);
    return (-1 != SkStrFind(string, substring));
}
static inline bool SkStrContains(const char string[], const char subchar) {
    SkASSERT(string);
    char tmp[2];
    tmp[0] = subchar;
    tmp[1] = '\0';
    return (-1 != SkStrFind(string, tmp));
}

/*
 *  The SkStrAppend... methods will write into the provided buffer, assuming it is large enough.
 *  Each method has an associated const (e.g. kSkStrAppendU32_MaxSize) which will be the largest
 *  value needed for that method's buffer.
 *
 *  char storage[kSkStrAppendU32_MaxSize];
 *  SkStrAppendU32(storage, value);
 *
 *  Note : none of the SkStrAppend... methods write a terminating 0 to their buffers. Instead,
 *  the methods return the ptr to the end of the written part of the buffer. This can be used
 *  to compute the length, and/or know where to write a 0 if that is desired.
 *
 *  char storage[kSkStrAppendU32_MaxSize + 1];
 *  char* stop = SkStrAppendU32(storage, value);
 *  size_t len = stop - storage;
 *  *stop = 0;   // valid, since storage was 1 byte larger than the max.
 */

static constexpr int kSkStrAppendU32_MaxSize = 10;
char*   SkStrAppendU32(char buffer[], uint32_t);
static constexpr int kSkStrAppendU64_MaxSize = 20;
char*   SkStrAppendU64(char buffer[], uint64_t, int minDigits);

static constexpr int kSkStrAppendS32_MaxSize = kSkStrAppendU32_MaxSize + 1;
char*   SkStrAppendS32(char buffer[], int32_t);
static constexpr int kSkStrAppendS64_MaxSize = kSkStrAppendU64_MaxSize + 1;
char*   SkStrAppendS64(char buffer[], int64_t, int minDigits);

/**
 *  Floats have at most 8 significant digits, so we limit our %g to that.
 *  However, the total string could be 15 characters: -1.2345678e-005
 *
 *  In theory we should only expect up to 2 digits for the exponent, but on
 *  some platforms we have seen 3 (as in the example above).
 */
static constexpr int kSkStrAppendScalar_MaxSize = 15;

/**
 *  Write the scalar in decimal format into buffer, and return a pointer to
 *  the next char after the last one written. Note: a terminating 0 is not
 *  written into buffer, which must be at least kSkStrAppendScalar_MaxSize.
 *  Thus if the caller wants to add a 0 at the end, buffer must be at least
 *  kSkStrAppendScalar_MaxSize + 1 bytes large.
 */
char* SkStrAppendScalar(char buffer[], SkScalar);

/** \class SkString

    Light weight class for managing strings. Uses reference
    counting to make string assignments and copies very fast
    with no extra RAM cost. Assumes UTF8 encoding.
*/
class SK_API SkString {
public:
                SkString();
    explicit    SkString(size_t len);
    explicit    SkString(const char text[]);
                SkString(const char text[], size_t len);
                SkString(const SkString&);
                SkString(SkString&&);
    explicit    SkString(const std::string&);
    explicit    SkString(skstd::string_view);
                ~SkString();

    bool        isEmpty() const { return 0 == fRec->fLength; }
    size_t      size() const { return (size_t) fRec->fLength; }
    const char* c_str() const { return fRec->data(); }
    char operator[](size_t n) const { return this->c_str()[n]; }

    bool equals(const SkString&) const;
    bool equals(const char text[]) const;
    bool equals(const char text[], size_t len) const;

    bool startsWith(const char prefixStr[]) const {
        return SkStrStartsWith(fRec->data(), prefixStr);
    }
    bool startsWith(const char prefixChar) const {
        return SkStrStartsWith(fRec->data(), prefixChar);
    }
    bool endsWith(const char suffixStr[]) const {
        return SkStrEndsWith(fRec->data(), suffixStr);
    }
    bool endsWith(const char suffixChar) const {
        return SkStrEndsWith(fRec->data(), suffixChar);
    }
    bool contains(const char substring[]) const {
        return SkStrContains(fRec->data(), substring);
    }
    bool contains(const char subchar) const {
        return SkStrContains(fRec->data(), subchar);
    }
    int find(const char substring[]) const {
        return SkStrFind(fRec->data(), substring);
    }
    int findLastOf(const char subchar) const {
        return SkStrFindLastOf(fRec->data(), subchar);
    }

    friend bool operator==(const SkString& a, const SkString& b) {
        return a.equals(b);
    }
    friend bool operator!=(const SkString& a, const SkString& b) {
        return !a.equals(b);
    }

    // these methods edit the string

    SkString& operator=(const SkString&);
    SkString& operator=(SkString&&);
    SkString& operator=(const char text[]);

    char* writable_str();
    char& operator[](size_t n) { return this->writable_str()[n]; }

    void reset();
    /** String contents are preserved on resize. (For destructive resize, `set(nullptr, length)`.)
     * `resize` automatically reserves an extra byte at the end of the buffer for a null terminator.
     */
    void resize(size_t len);
    void set(const SkString& src) { *this = src; }
    void set(const char text[]);
    void set(const char text[], size_t len);

    void insert(size_t offset, const SkString& src) { this->insert(offset, src.c_str(), src.size()); }
    void insert(size_t offset, const char text[]);
    void insert(size_t offset, const char text[], size_t len);
    void insertUnichar(size_t offset, SkUnichar);
    void insertS32(size_t offset, int32_t value);
    void insertS64(size_t offset, int64_t value, int minDigits = 0);
    void insertU32(size_t offset, uint32_t value);
    void insertU64(size_t offset, uint64_t value, int minDigits = 0);
    void insertHex(size_t offset, uint32_t value, int minDigits = 0);
    void insertScalar(size_t offset, SkScalar);

    void append(const SkString& str) { this->insert((size_t)-1, str); }
    void append(const char text[]) { this->insert((size_t)-1, text); }
    void append(const char text[], size_t len) { this->insert((size_t)-1, text, len); }
    void appendUnichar(SkUnichar uni) { this->insertUnichar((size_t)-1, uni); }
    void appendS32(int32_t value) { this->insertS32((size_t)-1, value); }
    void appendS64(int64_t value, int minDigits = 0) { this->insertS64((size_t)-1, value, minDigits); }
    void appendU32(uint32_t value) { this->insertU32((size_t)-1, value); }
    void appendU64(uint64_t value, int minDigits = 0) { this->insertU64((size_t)-1, value, minDigits); }
    void appendHex(uint32_t value, int minDigits = 0) { this->insertHex((size_t)-1, value, minDigits); }
    void appendScalar(SkScalar value) { this->insertScalar((size_t)-1, value); }

    void prepend(const SkString& str) { this->insert(0, str); }
    void prepend(const char text[]) { this->insert(0, text); }
    void prepend(const char text[], size_t len) { this->insert(0, text, len); }
    void prependUnichar(SkUnichar uni) { this->insertUnichar(0, uni); }
    void prependS32(int32_t value) { this->insertS32(0, value); }
    void prependS64(int32_t value, int minDigits = 0) { this->insertS64(0, value, minDigits); }
    void prependHex(uint32_t value, int minDigits = 0) { this->insertHex(0, value, minDigits); }
    void prependScalar(SkScalar value) { this->insertScalar((size_t)-1, value); }

    void printf(const char format[], ...) SK_PRINTF_LIKE(2, 3);
    void printVAList(const char format[], va_list);
    void appendf(const char format[], ...) SK_PRINTF_LIKE(2, 3);
    void appendVAList(const char format[], va_list);
    void prependf(const char format[], ...) SK_PRINTF_LIKE(2, 3);
    void prependVAList(const char format[], va_list);

    void remove(size_t offset, size_t length);

    SkString& operator+=(const SkString& s) { this->append(s); return *this; }
    SkString& operator+=(const char text[]) { this->append(text); return *this; }
    SkString& operator+=(const char c) { this->append(&c, 1); return *this; }

    /**
     *  Swap contents between this and other. This function is guaranteed
     *  to never fail or throw.
     */
    void swap(SkString& other);

private:
    struct Rec {
    public:
        constexpr Rec(uint32_t len, int32_t refCnt) : fLength(len), fRefCnt(refCnt) {}
        static sk_sp<Rec> Make(const char text[], size_t len);
        char* data() { return fBeginningOfData; }
        const char* data() const { return fBeginningOfData; }
        void ref() const;
        void unref() const;
        bool unique() const;
#ifdef SK_DEBUG
        int32_t getRefCnt() const;
#endif
        uint32_t fLength; // logically size_t, but we want it to stay 32 bits

    private:
        mutable std::atomic<int32_t> fRefCnt;
        char fBeginningOfData[1] = {'\0'};

        // Ensure the unsized delete is called.
        void operator delete(void* p) { ::operator delete(p); }
    };
    sk_sp<Rec> fRec;

#ifdef SK_DEBUG
    const SkString& validate() const;
#else
    const SkString& validate() const { return *this; }
#endif

    static const Rec gEmptyRec;
};

/// Creates a new string and writes into it using a printf()-style format.
SkString SkStringPrintf(const char* format, ...) SK_PRINTF_LIKE(1, 2);
/// This makes it easier to write a caller as a VAR_ARGS function where the format string is
/// optional.
static inline SkString SkStringPrintf() { return SkString(); }

static inline void swap(SkString& a, SkString& b) {
    a.swap(b);
}

enum SkStrSplitMode {
    // Strictly return all results. If the input is ",," and the separator is ',' this will return
    // an array of three empty strings.
    kStrict_SkStrSplitMode,

    // Only nonempty results will be added to the results. Multiple separators will be
    // coalesced. Separators at the beginning and end of the input will be ignored.  If the input is
    // ",," and the separator is ',', this will return an empty vector.
    kCoalesce_SkStrSplitMode
};

// Split str on any characters in delimiters into out.  (Think, strtok with a sane API.)
void SkStrSplit(const char* str, const char* delimiters, SkStrSplitMode splitMode,
                SkTArray<SkString>* out);
inline void SkStrSplit(const char* str, const char* delimiters, SkTArray<SkString>* out) {
    SkStrSplit(str, delimiters, kCoalesce_SkStrSplitMode, out);
}

#endif
