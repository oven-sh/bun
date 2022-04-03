/*
 * Copyright 2021 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkOrderedFontMgr_DEFINED
#define SkOrderedFontMgr_DEFINED

#include "include/core/SkFontMgr.h"
#include <vector>
/**
 *  Collects an order list of other font managers, and visits them in order
 *  when a request to find or match is issued.
 *
 *  Note: this explicitly fails on any attempt to Make a typeface: all of
 *  those requests will return null.
 */
class SK_API SkOrderedFontMgr : public SkFontMgr {
public:
    SkOrderedFontMgr();
    ~SkOrderedFontMgr() override;

    void append(sk_sp<SkFontMgr>);

protected:
    int onCountFamilies() const override;
    void onGetFamilyName(int index, SkString* familyName) const override;
    SkFontStyleSet* onCreateStyleSet(int index)const override;

    SkFontStyleSet* onMatchFamily(const char familyName[]) const override;

    SkTypeface* onMatchFamilyStyle(const char familyName[], const SkFontStyle&) const override;
    SkTypeface* onMatchFamilyStyleCharacter(const char familyName[], const SkFontStyle&,
                                            const char* bcp47[], int bcp47Count,
                                            SkUnichar character) const override;

    // Note: all of these always return null
    sk_sp<SkTypeface> onMakeFromData(sk_sp<SkData>, int ttcIndex) const override;
    sk_sp<SkTypeface> onMakeFromStreamIndex(std::unique_ptr<SkStreamAsset>,
                                            int ttcIndex) const override;
    sk_sp<SkTypeface> onMakeFromStreamArgs(std::unique_ptr<SkStreamAsset>,
                                           const SkFontArguments&) const override;
    sk_sp<SkTypeface> onMakeFromFile(const char path[], int ttcIndex) const override;

    sk_sp<SkTypeface> onLegacyMakeTypeface(const char familyName[], SkFontStyle) const override;

private:
    std::vector<sk_sp<SkFontMgr>> fList;
};

#endif
