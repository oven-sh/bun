
/*
 * Copyright 2006 The Android Open Source Project
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */


#ifndef SkTime_DEFINED
#define SkTime_DEFINED

#include "include/core/SkTypes.h"
#include "include/private/SkMacros.h"

#include <cinttypes>

class SkString;

/** \class SkTime
    Platform-implemented utilities to return time of day, and millisecond counter.
*/
class SK_API SkTime {
public:
    struct DateTime {
        int16_t  fTimeZoneMinutes;  // The number of minutes that GetDateTime()
                                    // is ahead of or behind UTC.
        uint16_t fYear;          //!< e.g. 2005
        uint8_t  fMonth;         //!< 1..12
        uint8_t  fDayOfWeek;     //!< 0..6, 0==Sunday
        uint8_t  fDay;           //!< 1..31
        uint8_t  fHour;          //!< 0..23
        uint8_t  fMinute;        //!< 0..59
        uint8_t  fSecond;        //!< 0..59

        void toISO8601(SkString* dst) const;
    };
    static void GetDateTime(DateTime*);

    static double GetSecs() { return GetNSecs() * 1e-9; }
    static double GetMSecs() { return GetNSecs() * 1e-6; }
    static double GetNSecs();
};

///////////////////////////////////////////////////////////////////////////////

class SkAutoTime {
public:
    // The label is not deep-copied, so its address must remain valid for the
    // lifetime of this object
    SkAutoTime(const char* label = nullptr)
        : fLabel(label)
        , fNow(SkTime::GetMSecs()) {}
    ~SkAutoTime() {
        uint64_t dur = static_cast<uint64_t>(SkTime::GetMSecs() - fNow);
        SkDebugf("%s %" PRIu64 "\n", fLabel ? fLabel : "", dur);
    }
private:
    const char* fLabel;
    double      fNow;
};

#endif
