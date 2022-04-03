/*
 * Copyright 2014 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkRemotableFontMgr_DEFINED
#define SkRemotableFontMgr_DEFINED

#include "include/core/SkFontStyle.h"
#include "include/core/SkRefCnt.h"
#include "include/core/SkTypes.h"
#include "include/private/SkTemplates.h"

class SkDataTable;
class SkStreamAsset;

struct SK_API SkFontIdentity {
    static const uint32_t kInvalidDataId = 0xFFFFFFFF;

    // Note that fDataId is a data identifier, not a font identifier.
    // (fDataID, fTtcIndex) can be seen as a font identifier.
    uint32_t fDataId;
    uint32_t fTtcIndex;

    // On Linux/FontConfig there is also the ability to specify preferences for rendering
    // antialias, embedded bitmaps, autohint, hinting, hintstyle, lcd rendering
    // may all be set or set to no-preference
    // (No-preference is resolved against globals set by the platform)
    // Since they may be selected against, these are really 'extensions' to SkFontStyle.
    // SkFontStyle should pick these up.
    SkFontStyle fFontStyle;
};

class SK_API SkRemotableFontIdentitySet : public SkRefCnt {
public:
    SkRemotableFontIdentitySet(int count, SkFontIdentity** data);

    int count() const { return fCount; }
    const SkFontIdentity& at(int index) const { return fData[index]; }

    static SkRemotableFontIdentitySet* NewEmpty();

private:
    SkRemotableFontIdentitySet() : fCount(0), fData() { }

    friend SkRemotableFontIdentitySet* sk_remotable_font_identity_set_new();

    int fCount;
    SkAutoTArray<SkFontIdentity> fData;

    using INHERITED = SkRefCnt;
};

class SK_API SkRemotableFontMgr : public SkRefCnt {
public:
    /**
     *  Returns all of the fonts with the given familyIndex.
     *  Returns NULL if the index is out of bounds.
     *  Returns empty if there are no fonts at the given index.
     *
     *  The caller must unref() the returned object.
     */
    virtual SkRemotableFontIdentitySet* getIndex(int familyIndex) const = 0;

    /**
     *  Returns the closest match to the given style in the given index.
     *  If there are no available fonts at the given index, the return value's
     *  data id will be kInvalidDataId.
     */
    virtual SkFontIdentity matchIndexStyle(int familyIndex, const SkFontStyle&) const = 0;

    /**
     *  Returns all the fonts on the system with the given name.
     *  If the given name is NULL, will return the default font family.
     *  Never returns NULL; will return an empty set if the name is not found.
     *
     *  It is possible that this will return fonts not accessible from
     *  getIndex(int) or matchIndexStyle(int, SkFontStyle) due to
     *  hidden or auto-activated fonts.
     *
     *  The matching may be done in a system dependent way. The name may be
     *  matched case-insensitive, there may be system aliases which resolve,
     *  and names outside the current locale may be considered. However, this
     *  should only return fonts which are somehow associated with the requested
     *  name.
     *
     *  The caller must unref() the returned object.
     */
    virtual SkRemotableFontIdentitySet* matchName(const char familyName[]) const = 0;

    /**
     *  Returns the closest matching font to the specified name and style.
     *  If there are no available fonts which match the name, the return value's
     *  data id will be kInvalidDataId.
     *  If the given name is NULL, the match will be against any default fonts.
     *
     *  It is possible that this will return a font identity not accessible from
     *  methods returning sets due to hidden or auto-activated fonts.
     *
     *  The matching may be done in a system dependent way. The name may be
     *  matched case-insensitive, there may be system aliases which resolve,
     *  and names outside the current locale may be considered. However, this
     *  should only return a font which is somehow associated with the requested
     *  name.
     *
     *  The caller must unref() the returned object.
     */
    virtual SkFontIdentity matchNameStyle(const char familyName[], const SkFontStyle&) const = 0;

    /**
     *  Use the system fall-back to find a font for the given character.
     *  If no font can be found for the character, the return value's data id
     *  will be kInvalidDataId.
     *  If the name is NULL, the match will start against any default fonts.
     *  If the bpc47 is NULL, a default locale will be assumed.
     *
     *  Note that bpc47 is a combination of ISO 639, 15924, and 3166-1 codes,
     *  so it is fine to just pass a ISO 639 here.
     */
    virtual SkFontIdentity matchNameStyleCharacter(const char familyName[], const SkFontStyle&,
                                                   const char* bcp47[], int bcp47Count,
                                                   SkUnichar character) const=0;

    /**
     *  Returns the data for the given data id.
     *  Will return NULL if the data id is invalid.
     *  Note that this is a data id, not a font id.
     *
     *  The caller must unref() the returned object.
     */
    virtual SkStreamAsset* getData(int dataId) const = 0;

private:
    using INHERITED = SkRefCnt;
};

#endif
