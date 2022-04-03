/*
 * Copyright 2013 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkFontConfigInterface_DEFINED
#define SkFontConfigInterface_DEFINED

#include "include/core/SkFontStyle.h"
#include "include/core/SkRefCnt.h"
#include "include/core/SkStream.h"
#include "include/core/SkTypeface.h"

class SkFontMgr;

/**
 *  \class SkFontConfigInterface
 *
 *  A simple interface for remotable font management.
 *  The global instance can be found with RefGlobal().
 */
class SK_API SkFontConfigInterface : public SkRefCnt {
public:

    /**
     *  Returns the global SkFontConfigInterface instance. If it is not
     *  nullptr, calls ref() on it. The caller must balance this with a call to
     *  unref(). The default SkFontConfigInterface is the result of calling
     *  GetSingletonDirectInterface.
     */
    static sk_sp<SkFontConfigInterface> RefGlobal();

    /**
     *  Replace the current global instance with the specified one.
     */
    static void SetGlobal(sk_sp<SkFontConfigInterface> fc);

    /**
     *  This should be treated as private to the impl of SkFontConfigInterface.
     *  Callers should not change or expect any particular values. It is meant
     *  to be a union of possible storage types to aid the impl.
     */
    struct FontIdentity {
        FontIdentity() : fID(0), fTTCIndex(0) {}

        bool operator==(const FontIdentity& other) const {
            return fID == other.fID &&
                   fTTCIndex == other.fTTCIndex &&
                   fString == other.fString;
        }
        bool operator!=(const FontIdentity& other) const {
            return !(*this == other);
        }

        uint32_t    fID;
        int32_t     fTTCIndex;
        SkString    fString;
        SkFontStyle fStyle;

        // If buffer is NULL, just return the number of bytes that would have
        // been written. Will pad contents to a multiple of 4.
        size_t writeToMemory(void* buffer = nullptr) const;

        // Recreate from a flattened buffer, returning the number of bytes read.
        size_t readFromMemory(const void* buffer, size_t length);
    };

    /**
     *  Given a familyName and style, find the best match.
     *
     *  If a match is found, return true and set its outFontIdentifier.
     *      If outFamilyName is not null, assign the found familyName to it
     *          (which may differ from the requested familyName).
     *      If outStyle is not null, assign the found style to it
     *          (which may differ from the requested style).
     *
     *  If a match is not found, return false, and ignore all out parameters.
     */
    virtual bool matchFamilyName(const char familyName[],
                                 SkFontStyle requested,
                                 FontIdentity* outFontIdentifier,
                                 SkString* outFamilyName,
                                 SkFontStyle* outStyle) = 0;

    /**
     *  Given a FontRef, open a stream to access its data, or return null
     *  if the FontRef's data is not available. The caller is responsible for
     *  deleting the stream when it is done accessing the data.
     */
    virtual SkStreamAsset* openStream(const FontIdentity&) = 0;

    /**
     *  Return an SkTypeface for the given FontIdentity.
     *
     *  The default implementation simply returns a new typeface built using data obtained from
     *  openStream(), but derived classes may implement more complex caching schemes.
     */
    virtual sk_sp<SkTypeface> makeTypeface(const FontIdentity& identity) {
        return SkTypeface::MakeFromStream(std::unique_ptr<SkStreamAsset>(this->openStream(identity)),
                                          identity.fTTCIndex);

    }

    /**
     *  Return a singleton instance of a direct subclass that calls into
     *  libfontconfig. This does not affect the refcnt of the returned instance.
     */
    static SkFontConfigInterface* GetSingletonDirectInterface();

    using INHERITED = SkRefCnt;
};

#endif
