/*
 * Copyright 2006 The Android Open Source Project
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkRandom_DEFINED
#define SkRandom_DEFINED

#include "include/core/SkScalar.h"
#include "include/private/SkFixed.h"
#include "include/private/SkFloatBits.h"

/** \class SkRandom

 Utility class that implements pseudo random 32bit numbers using Marsaglia's
 multiply-with-carry "mother of all" algorithm. Unlike rand(), this class holds
 its own state, so that multiple instances can be used with no side-effects.

 Has a large period and all bits are well-randomized.
 */
class SkRandom {
public:
    SkRandom() { init(0); }
    SkRandom(uint32_t seed) { init(seed); }
    SkRandom(const SkRandom& rand) : fK(rand.fK), fJ(rand.fJ) {}

    SkRandom& operator=(const SkRandom& rand) {
        fK = rand.fK;
        fJ = rand.fJ;

        return *this;
    }

    /** Return the next pseudo random number as an unsigned 32bit value.
     */
    uint32_t nextU() {
        fK = kKMul*(fK & 0xffff) + (fK >> 16);
        fJ = kJMul*(fJ & 0xffff) + (fJ >> 16);
        return (((fK << 16) | (fK >> 16)) + fJ);
    }

    /** Return the next pseudo random number as a signed 32bit value.
     */
    int32_t nextS() { return (int32_t)this->nextU(); }

    /**
     *  Returns value [0...1) as an IEEE float
     */
    float nextF() {
        int floatint = 0x3f800000 | (int)(this->nextU() >> 9);
        float f = SkBits2Float(floatint) - 1.0f;
        return f;
    }

    /**
     *  Returns value [min...max) as a float
     */
    float nextRangeF(float min, float max) {
        return min + this->nextF() * (max - min);
    }

    /** Return the next pseudo random number, as an unsigned value of
     at most bitCount bits.
     @param bitCount The maximum number of bits to be returned
     */
    uint32_t nextBits(unsigned bitCount) {
        SkASSERT(bitCount > 0 && bitCount <= 32);
        return this->nextU() >> (32 - bitCount);
    }

    /** Return the next pseudo random unsigned number, mapped to lie within
     [min, max] inclusive.
     */
    uint32_t nextRangeU(uint32_t min, uint32_t max) {
        SkASSERT(min <= max);
        uint32_t range = max - min + 1;
        if (0 == range) {
            return this->nextU();
        } else {
            return min + this->nextU() % range;
        }
    }

    /** Return the next pseudo random unsigned number, mapped to lie within
     [0, count).
     */
    uint32_t nextULessThan(uint32_t count) {
        SkASSERT(count > 0);
        return this->nextRangeU(0, count - 1);
    }

    /** Return the next pseudo random number expressed as a SkScalar
     in the range [0..SK_Scalar1).
     */
    SkScalar nextUScalar1() { return SkFixedToScalar(this->nextUFixed1()); }

    /** Return the next pseudo random number expressed as a SkScalar
     in the range [min..max).
     */
    SkScalar nextRangeScalar(SkScalar min, SkScalar max) {
        return this->nextUScalar1() * (max - min) + min;
    }

    /** Return the next pseudo random number expressed as a SkScalar
     in the range [-SK_Scalar1..SK_Scalar1).
     */
    SkScalar nextSScalar1() { return SkFixedToScalar(this->nextSFixed1()); }

    /** Return the next pseudo random number as a bool.
     */
    bool nextBool() { return this->nextU() >= 0x80000000; }

    /** A biased version of nextBool().
     */
    bool nextBiasedBool(SkScalar fractionTrue) {
        SkASSERT(fractionTrue >= 0 && fractionTrue <= SK_Scalar1);
        return this->nextUScalar1() <= fractionTrue;
    }

    /** Reset the random object.
     */
    void setSeed(uint32_t seed) { init(seed); }

private:
    // Initialize state variables with LCG.
    // We must ensure that both J and K are non-zero, otherwise the
    // multiply-with-carry step will forevermore return zero.
    void init(uint32_t seed) {
        fK = NextLCG(seed);
        if (0 == fK) {
            fK = NextLCG(fK);
        }
        fJ = NextLCG(fK);
        if (0 == fJ) {
            fJ = NextLCG(fJ);
        }
        SkASSERT(0 != fK && 0 != fJ);
    }
    static uint32_t NextLCG(uint32_t seed) { return kMul*seed + kAdd; }

    /** Return the next pseudo random number expressed as an unsigned SkFixed
     in the range [0..SK_Fixed1).
     */
    SkFixed nextUFixed1() { return this->nextU() >> 16; }

    /** Return the next pseudo random number expressed as a signed SkFixed
     in the range [-SK_Fixed1..SK_Fixed1).
     */
    SkFixed nextSFixed1() { return this->nextS() >> 15; }

    //  See "Numerical Recipes in C", 1992 page 284 for these constants
    //  For the LCG that sets the initial state from a seed
    enum {
        kMul = 1664525,
        kAdd = 1013904223
    };
    // Constants for the multiply-with-carry steps
    enum {
        kKMul = 30345,
        kJMul = 18000,
    };

    uint32_t fK;
    uint32_t fJ;
};

#endif
