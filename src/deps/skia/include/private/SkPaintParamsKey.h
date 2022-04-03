/*
 * Copyright 2022 Google LLC
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkPaintParamsKey_DEFINED
#define SkPaintParamsKey_DEFINED

#include <array>
#include <limits>
#include "include/core/SkTypes.h"

enum class SkBackend : uint8_t {
    kGanesh,
    kGraphite,
    kSkVM
};

// TODO: this needs to be expanded into a more flexible dictionary (esp. for user-supplied SkSL)
// TODO: should this enum actually be in ShaderCodeDictionary.h?
enum class CodeSnippetID : uint8_t {
    // TODO: It seems like this requires some refinement. Fundamentally this doesn't seem like a
    // draw that originated from a PaintParams.
    kDepthStencilOnlyDraw,

    // SkShader code snippets
    kSolidColorShader,
    kLinearGradientShader,
    kRadialGradientShader,
    kSweepGradientShader,
    kConicalGradientShader,

    // BlendMode code snippets
    kSimpleBlendMode,

    kLast = kSimpleBlendMode
};
static constexpr int kCodeSnippetIDCount = static_cast<int>(CodeSnippetID::kLast) + 1;

// This class is a compact representation of the shader needed to implement a given
// PaintParams. Its structure is a series of blocks where each block has a
// header that consists of 2-bytes - a 1-byte code-snippet ID and a 1-byte number-of-bytes-in-the-
// block field. The rest of the data in the block is dependent on the individual code snippet.
class SkPaintParamsKey {
public:
    static const int kBlockHeaderSizeInBytes = 2;
    static const int kBlockSizeOffsetInBytes = 1; // offset to the block size w/in the header

    // Block headers have the following structure:
    //  1st byte: codeSnippetID
    //  2nd byte: total blockSize in bytes
    // Returns the header's offset in the key - to be passed back into endBlock
    int beginBlock(CodeSnippetID codeSnippetID) {
        SkASSERT(fNumBytes < kMaxKeySize);

        this->addByte((uint8_t) codeSnippetID);
        this->addByte(0); // this needs to be patched up with a call to endBlock
        return fNumBytes - kBlockHeaderSizeInBytes;
    }

    // Update the size byte of a block header
    void endBlock(int headerOffset, CodeSnippetID codeSnippetID) {
        SkASSERT(fData[headerOffset] == (uint32_t) codeSnippetID);
        int blockSize = fNumBytes - headerOffset;
        SkASSERT(blockSize <= kMaxBlockSize);
        fData[headerOffset+1] = blockSize;
    }

    std::pair<CodeSnippetID, uint8_t> readCodeSnippetID(int headerOffset) const {
        SkASSERT(headerOffset < kMaxKeySize - kBlockHeaderSizeInBytes);

        CodeSnippetID id = static_cast<CodeSnippetID>(fData[headerOffset]);
        uint8_t blockSize = fData[headerOffset+1];
        SkASSERT(headerOffset + blockSize <= this->sizeInBytes());

        return { id, blockSize };
    }

    void addByte(uint8_t byte) {
        SkASSERT(fNumBytes < kMaxKeySize);

        fData[fNumBytes++] = byte;
    }

#ifdef SK_DEBUG
    static int DumpBlock(const SkPaintParamsKey&, int headerOffset);
    void dump() const;
#endif

    uint8_t byte(int offset) const { SkASSERT(offset < fNumBytes); return fData[offset]; }
    const void* data() const { return fData.data(); }
    int sizeInBytes() const { return fNumBytes; }

    bool operator==(const SkPaintParamsKey& that) const;
    bool operator!=(const SkPaintParamsKey& that) const { return !(*this == that); }

private:
    // TODO: need to make it so the key can can dynamically grow
    static const int kMaxKeySize = 32;
    static const int kMaxBlockSize = std::numeric_limits<uint8_t>::max();

    // TODO: It is probably overkill but we could encode the SkBackend in the first byte of
    // the key.
    int fNumBytes = 0;
    std::array<uint8_t, kMaxKeySize> fData;
};

#endif // SkPaintParamsKey_DEFINED
