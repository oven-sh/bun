/*
 * Copyright 2016 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef GrSingleOwner_DEFINED
#define GrSingleOwner_DEFINED

#include "include/core/SkTypes.h"

#ifdef SK_DEBUG
#include "include/private/SkMutex.h"
#include "include/private/SkThreadID.h"

#define GR_ASSERT_SINGLE_OWNER(obj) \
    GrSingleOwner::AutoEnforce debug_SingleOwner(obj, __FILE__, __LINE__);

// This is a debug tool to verify an object is only being used from one thread at a time.
class GrSingleOwner {
public:
     GrSingleOwner() : fOwner(kIllegalThreadID), fReentranceCount(0) {}

     struct AutoEnforce {
         AutoEnforce(GrSingleOwner* so, const char* file, int line)
                : fFile(file), fLine(line), fSO(so) {
             fSO->enter(file, line);
         }
         ~AutoEnforce() { fSO->exit(fFile, fLine); }

         const char* fFile;
         int fLine;
         GrSingleOwner* fSO;
     };

private:
     void enter(const char* file, int line) {
         SkAutoMutexExclusive lock(fMutex);
         SkThreadID self = SkGetThreadID();
         SkASSERTF(fOwner == self || fOwner == kIllegalThreadID, "%s:%d Single owner failure.",
                   file, line);
         fReentranceCount++;
         fOwner = self;
     }

     void exit(const char* file, int line) {
         SkAutoMutexExclusive lock(fMutex);
         SkASSERTF(fOwner == SkGetThreadID(), "%s:%d Single owner failure.", file, line);
         fReentranceCount--;
         if (fReentranceCount == 0) {
             fOwner = kIllegalThreadID;
         }
     }

     SkMutex fMutex;
     SkThreadID fOwner    SK_GUARDED_BY(fMutex);
     int fReentranceCount SK_GUARDED_BY(fMutex);
};
#else
#define GR_ASSERT_SINGLE_OWNER(obj)
class GrSingleOwner {}; // Provide a no-op implementation so we can pass pointers to constructors
#endif

#endif
