/*
 * Copyright 2006 The Android Open Source Project
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkTypeface_DEFINED
#define SkTypeface_DEFINED

#include "include/core/SkFontArguments.h"
#include "include/core/SkFontParameters.h"
#include "include/core/SkFontStyle.h"
#include "include/core/SkFontTypes.h"
#include "include/core/SkRect.h"
#include "include/core/SkString.h"
#include "include/private/SkOnce.h"
#include "include/private/SkWeakRefCnt.h"

class SkData;
class SkDescriptor;
class SkFontData;
class SkFontDescriptor;
class SkScalerContext;
class SkStream;
class SkStreamAsset;
class SkWStream;
struct SkAdvancedTypefaceMetrics;
struct SkScalerContextEffects;
struct SkScalerContextRec;

typedef uint32_t SkFontID;
/** Machine endian. */
typedef uint32_t SkFontTableTag;

/** \class SkTypeface

    The SkTypeface class specifies the typeface and intrinsic style of a font.
    This is used in the paint, along with optionally algorithmic settings like
    textSize, textSkewX, textScaleX, kFakeBoldText_Mask, to specify
    how text appears when drawn (and measured).

    Typeface objects are immutable, and so they can be shared between threads.
*/
class SK_API SkTypeface : public SkWeakRefCnt {
public:
    /** Returns the typeface's intrinsic style attributes. */
    SkFontStyle fontStyle() const {
        return fStyle;
    }

    /** Returns true if style() has the kBold bit set. */
    bool isBold() const { return fStyle.weight() >= SkFontStyle::kSemiBold_Weight; }

    /** Returns true if style() has the kItalic bit set. */
    bool isItalic() const { return fStyle.slant() != SkFontStyle::kUpright_Slant; }

    /** Returns true if the typeface claims to be fixed-pitch.
     *  This is a style bit, advance widths may vary even if this returns true.
     */
    bool isFixedPitch() const { return fIsFixedPitch; }

    /** Copy into 'coordinates' (allocated by the caller) the design variation coordinates.
     *
     *  @param coordinates the buffer into which to write the design variation coordinates.
     *  @param coordinateCount the number of entries available through 'coordinates'.
     *
     *  @return The number of axes, or -1 if there is an error.
     *  If 'coordinates != nullptr' and 'coordinateCount >= numAxes' then 'coordinates' will be
     *  filled with the variation coordinates describing the position of this typeface in design
     *  variation space. It is possible the number of axes can be retrieved but actual position
     *  cannot.
     */
    int getVariationDesignPosition(SkFontArguments::VariationPosition::Coordinate coordinates[],
                                   int coordinateCount) const;

    /** Copy into 'parameters' (allocated by the caller) the design variation parameters.
     *
     *  @param parameters the buffer into which to write the design variation parameters.
     *  @param coordinateCount the number of entries available through 'parameters'.
     *
     *  @return The number of axes, or -1 if there is an error.
     *  If 'parameters != nullptr' and 'parameterCount >= numAxes' then 'parameters' will be
     *  filled with the variation parameters describing the position of this typeface in design
     *  variation space. It is possible the number of axes can be retrieved but actual parameters
     *  cannot.
     */
    int getVariationDesignParameters(SkFontParameters::Variation::Axis parameters[],
                                     int parameterCount) const;

    /** Return a 32bit value for this typeface, unique for the underlying font
        data. Will never return 0.
     */
    SkFontID uniqueID() const { return fUniqueID; }

    /** Return the uniqueID for the specified typeface. If the face is null,
        resolve it to the default font and return its uniqueID. Will never
        return 0.
    */
    static SkFontID UniqueID(const SkTypeface* face);

    /** Returns true if the two typefaces reference the same underlying font,
        handling either being null (treating null as the default font)
     */
    static bool Equal(const SkTypeface* facea, const SkTypeface* faceb);

    /** Returns the default normal typeface, which is never nullptr. */
    static sk_sp<SkTypeface> MakeDefault();

    /** Creates a new reference to the typeface that most closely matches the
        requested familyName and fontStyle. This method allows extended font
        face specifiers as in the SkFontStyle type. Will never return null.

        @param familyName  May be NULL. The name of the font family.
        @param fontStyle   The style of the typeface.
        @return reference to the closest-matching typeface. Call must call
              unref() when they are done.
    */
    static sk_sp<SkTypeface> MakeFromName(const char familyName[], SkFontStyle fontStyle);

    /** Return a new typeface given a file. If the file does not exist, or is
        not a valid font file, returns nullptr.
    */
    static sk_sp<SkTypeface> MakeFromFile(const char path[], int index = 0);

    /** Return a new typeface given a stream. If the stream is
        not a valid font file, returns nullptr. Ownership of the stream is
        transferred, so the caller must not reference it again.
    */
    static sk_sp<SkTypeface> MakeFromStream(std::unique_ptr<SkStreamAsset> stream, int index = 0);

    /** Return a new typeface given a SkData. If the data is null, or is not a valid font file,
     *  returns nullptr.
     */
    static sk_sp<SkTypeface> MakeFromData(sk_sp<SkData>, int index = 0);

    /** Return a new typeface based on this typeface but parameterized as specified in the
        SkFontArguments. If the SkFontArguments does not supply an argument for a parameter
        in the font then the value from this typeface will be used as the value for that
        argument. If the cloned typeface would be exaclty the same as this typeface then
        this typeface may be ref'ed and returned. May return nullptr on failure.
    */
    sk_sp<SkTypeface> makeClone(const SkFontArguments&) const;

    /**
     *  A typeface can serialize just a descriptor (names, etc.), or it can also include the
     *  actual font data (which can be large). This enum controls how serialize() decides what
     *  to serialize.
     */
    enum class SerializeBehavior {
        kDoIncludeData,
        kDontIncludeData,
        kIncludeDataIfLocal,
    };

    /** Write a unique signature to a stream, sufficient to reconstruct a
        typeface referencing the same font when Deserialize is called.
     */
    void serialize(SkWStream*, SerializeBehavior = SerializeBehavior::kIncludeDataIfLocal) const;

    /**
     *  Same as serialize(SkWStream*, ...) but returns the serialized data in SkData, instead of
     *  writing it to a stream.
     */
    sk_sp<SkData> serialize(SerializeBehavior = SerializeBehavior::kIncludeDataIfLocal) const;

    /** Given the data previously written by serialize(), return a new instance
        of a typeface referring to the same font. If that font is not available,
        return nullptr.
        Does not affect ownership of SkStream.
     */
    static sk_sp<SkTypeface> MakeDeserialize(SkStream*);

    /**
     *  Given an array of UTF32 character codes, return their corresponding glyph IDs.
     *
     *  @param chars pointer to the array of UTF32 chars
     *  @param number of chars and glyphs
     *  @param glyphs returns the corresponding glyph IDs for each character.
     */
    void unicharsToGlyphs(const SkUnichar uni[], int count, SkGlyphID glyphs[]) const;

    int textToGlyphs(const void* text, size_t byteLength, SkTextEncoding encoding,
                     SkGlyphID glyphs[], int maxGlyphCount) const;

    /**
     *  Return the glyphID that corresponds to the specified unicode code-point
     *  (in UTF32 encoding). If the unichar is not supported, returns 0.
     *
     *  This is a short-cut for calling unicharsToGlyphs().
     */
    SkGlyphID unicharToGlyph(SkUnichar unichar) const;

    /**
     *  Return the number of glyphs in the typeface.
     */
    int countGlyphs() const;

    // Table getters -- may fail if the underlying font format is not organized
    // as 4-byte tables.

    /** Return the number of tables in the font. */
    int countTables() const;

    /** Copy into tags[] (allocated by the caller) the list of table tags in
     *  the font, and return the number. This will be the same as CountTables()
     *  or 0 if an error occured. If tags == NULL, this only returns the count
     *  (the same as calling countTables()).
     */
    int getTableTags(SkFontTableTag tags[]) const;

    /** Given a table tag, return the size of its contents, or 0 if not present
     */
    size_t getTableSize(SkFontTableTag) const;

    /** Copy the contents of a table into data (allocated by the caller). Note
     *  that the contents of the table will be in their native endian order
     *  (which for most truetype tables is big endian). If the table tag is
     *  not found, or there is an error copying the data, then 0 is returned.
     *  If this happens, it is possible that some or all of the memory pointed
     *  to by data may have been written to, even though an error has occured.
     *
     *  @param tag  The table tag whose contents are to be copied
     *  @param offset The offset in bytes into the table's contents where the
     *  copy should start from.
     *  @param length The number of bytes, starting at offset, of table data
     *  to copy.
     *  @param data storage address where the table contents are copied to
     *  @return the number of bytes actually copied into data. If offset+length
     *  exceeds the table's size, then only the bytes up to the table's
     *  size are actually copied, and this is the value returned. If
     *  offset > the table's size, or tag is not a valid table,
     *  then 0 is returned.
     */
    size_t getTableData(SkFontTableTag tag, size_t offset, size_t length,
                        void* data) const;

    /**
     *  Return an immutable copy of the requested font table, or nullptr if that table was
     *  not found. This can sometimes be faster than calling getTableData() twice: once to find
     *  the length, and then again to copy the data.
     *
     *  @param tag  The table tag whose contents are to be copied
     *  @return an immutable copy of the table's data, or nullptr.
     */
    sk_sp<SkData> copyTableData(SkFontTableTag tag) const;

    /**
     *  Return the units-per-em value for this typeface, or zero if there is an
     *  error.
     */
    int getUnitsPerEm() const;

    /**
     *  Given a run of glyphs, return the associated horizontal adjustments.
     *  Adjustments are in "design units", which are integers relative to the
     *  typeface's units per em (see getUnitsPerEm).
     *
     *  Some typefaces are known to never support kerning. Calling this method
     *  with all zeros (e.g. getKerningPairAdustments(NULL, 0, NULL)) returns
     *  a boolean indicating if the typeface might support kerning. If it
     *  returns false, then it will always return false (no kerning) for all
     *  possible glyph runs. If it returns true, then it *may* return true for
     *  somne glyph runs.
     *
     *  If count is non-zero, then the glyphs parameter must point to at least
     *  [count] valid glyph IDs, and the adjustments parameter must be
     *  sized to at least [count - 1] entries. If the method returns true, then
     *  [count-1] entries in the adjustments array will be set. If the method
     *  returns false, then no kerning should be applied, and the adjustments
     *  array will be in an undefined state (possibly some values may have been
     *  written, but none of them should be interpreted as valid values).
     */
    bool getKerningPairAdjustments(const SkGlyphID glyphs[], int count,
                                   int32_t adjustments[]) const;

    struct LocalizedString {
        SkString fString;
        SkString fLanguage;
    };
    class LocalizedStrings {
    public:
        LocalizedStrings() = default;
        virtual ~LocalizedStrings() { }
        virtual bool next(LocalizedString* localizedString) = 0;
        void unref() { delete this; }

    private:
        LocalizedStrings(const LocalizedStrings&) = delete;
        LocalizedStrings& operator=(const LocalizedStrings&) = delete;
    };
    /**
     *  Returns an iterator which will attempt to enumerate all of the
     *  family names specified by the font.
     *  It is the caller's responsibility to unref() the returned pointer.
     */
    LocalizedStrings* createFamilyNameIterator() const;

    /**
     *  Return the family name for this typeface. It will always be returned
     *  encoded as UTF8, but the language of the name is whatever the host
     *  platform chooses.
     */
    void getFamilyName(SkString* name) const;

    /**
     *  Return the PostScript name for this typeface.
     *  Value may change based on variation parameters.
     *  Returns false if no PostScript name is available.
     */
    bool getPostScriptName(SkString* name) const;

    /**
     *  Return a stream for the contents of the font data, or NULL on failure.
     *  If ttcIndex is not null, it is set to the TrueTypeCollection index
     *  of this typeface within the stream, or 0 if the stream is not a
     *  collection.
     *  The caller is responsible for deleting the stream.
     */
    std::unique_ptr<SkStreamAsset> openStream(int* ttcIndex) const;

    /**
     *  Return a scalercontext for the given descriptor. It may return a
     *  stub scalercontext that will not crash, but will draw nothing.
     */
    std::unique_ptr<SkScalerContext> createScalerContext(const SkScalerContextEffects&,
                                                         const SkDescriptor*) const;

    /**
     *  Return a rectangle (scaled to 1-pt) that represents the union of the bounds of all
     *  of the glyphs, but each one positioned at (0,). This may be conservatively large, and
     *  will not take into account any hinting or other size-specific adjustments.
     */
    SkRect getBounds() const;

    // PRIVATE / EXPERIMENTAL -- do not call
    void filterRec(SkScalerContextRec* rec) const {
        this->onFilterRec(rec);
    }
    // PRIVATE / EXPERIMENTAL -- do not call
    void getFontDescriptor(SkFontDescriptor* desc, bool* isLocal) const {
        this->onGetFontDescriptor(desc, isLocal);
    }
    // PRIVATE / EXPERIMENTAL -- do not call
    void* internal_private_getCTFontRef() const {
        return this->onGetCTFontRef();
    }

protected:
    explicit SkTypeface(const SkFontStyle& style, bool isFixedPitch = false);
    ~SkTypeface() override;

    virtual sk_sp<SkTypeface> onMakeClone(const SkFontArguments&) const = 0;

    /** Sets the fixedPitch bit. If used, must be called in the constructor. */
    void setIsFixedPitch(bool isFixedPitch) { fIsFixedPitch = isFixedPitch; }
    /** Sets the font style. If used, must be called in the constructor. */
    void setFontStyle(SkFontStyle style) { fStyle = style; }

    // Must return a valid scaler context. It can not return nullptr.
    virtual std::unique_ptr<SkScalerContext> onCreateScalerContext(const SkScalerContextEffects&,
                                                                   const SkDescriptor*) const = 0;
    virtual void onFilterRec(SkScalerContextRec*) const = 0;
    friend class SkScalerContext;  // onFilterRec

    //  Subclasses *must* override this method to work with the PDF backend.
    virtual std::unique_ptr<SkAdvancedTypefaceMetrics> onGetAdvancedMetrics() const = 0;
    // For type1 postscript fonts only, set the glyph names for each glyph.
    // destination array is non-null, and points to an array of size this->countGlyphs().
    // Backends that do not suport type1 fonts should not override.
    virtual void getPostScriptGlyphNames(SkString*) const = 0;

    // The mapping from glyph to Unicode; array indices are glyph ids.
    // For each glyph, give the default Unicode value, if it exists.
    // dstArray is non-null, and points to an array of size this->countGlyphs().
    virtual void getGlyphToUnicodeMap(SkUnichar* dstArray) const = 0;

    virtual std::unique_ptr<SkStreamAsset> onOpenStream(int* ttcIndex) const = 0;

    virtual bool onGlyphMaskNeedsCurrentColor() const = 0;

    virtual int onGetVariationDesignPosition(
        SkFontArguments::VariationPosition::Coordinate coordinates[],
        int coordinateCount) const = 0;

    virtual int onGetVariationDesignParameters(
        SkFontParameters::Variation::Axis parameters[], int parameterCount) const = 0;

    virtual void onGetFontDescriptor(SkFontDescriptor*, bool* isLocal) const = 0;

    virtual void onCharsToGlyphs(const SkUnichar* chars, int count, SkGlyphID glyphs[]) const = 0;
    virtual int onCountGlyphs() const = 0;

    virtual int onGetUPEM() const = 0;
    virtual bool onGetKerningPairAdjustments(const SkGlyphID glyphs[], int count,
                                             int32_t adjustments[]) const;

    /** Returns the family name of the typeface as known by its font manager.
     *  This name may or may not be produced by the family name iterator.
     */
    virtual void onGetFamilyName(SkString* familyName) const = 0;
    virtual bool onGetPostScriptName(SkString*) const = 0;

    /** Returns an iterator over the family names in the font. */
    virtual LocalizedStrings* onCreateFamilyNameIterator() const = 0;

    virtual int onGetTableTags(SkFontTableTag tags[]) const = 0;
    virtual size_t onGetTableData(SkFontTableTag, size_t offset,
                                  size_t length, void* data) const = 0;
    virtual sk_sp<SkData> onCopyTableData(SkFontTableTag) const;

    virtual bool onComputeBounds(SkRect*) const;

    virtual void* onGetCTFontRef() const { return nullptr; }

private:
    /** Returns true if the typeface's glyph masks may refer to the foreground
     *  paint foreground color. This is needed to determine caching requirements. Usually true for
     *  typefaces that contain a COLR table.
     */
    bool glyphMaskNeedsCurrentColor() const;
    friend class SkStrikeServerImpl; // glyphMaskNeedsCurrentColor

    /** Retrieve detailed typeface metrics.  Used by the PDF backend.  */
    std::unique_ptr<SkAdvancedTypefaceMetrics> getAdvancedMetrics() const;
    friend class SkRandomTypeface;   // getAdvancedMetrics
    friend class SkPDFFont;          // getAdvancedMetrics

    /** Style specifies the intrinsic style attributes of a given typeface */
    enum Style {
        kNormal = 0,
        kBold   = 0x01,
        kItalic = 0x02,

        // helpers
        kBoldItalic = 0x03
    };
    static SkFontStyle FromOldStyle(Style oldStyle);
    static SkTypeface* GetDefaultTypeface(Style style = SkTypeface::kNormal);

    friend class SkFontPriv;         // GetDefaultTypeface
    friend class SkPaintPriv;        // GetDefaultTypeface
    friend class SkFont;             // getGlyphToUnicodeMap

private:
    SkFontID            fUniqueID;
    SkFontStyle         fStyle;
    mutable SkRect      fBounds;
    mutable SkOnce      fBoundsOnce;
    bool                fIsFixedPitch;

    using INHERITED = SkWeakRefCnt;
};
#endif
