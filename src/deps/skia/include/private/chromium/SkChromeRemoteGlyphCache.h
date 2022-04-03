/*
 * Copyright 2021 Google LLC.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkChromeRemoteGlyphCache_DEFINED
#define SkChromeRemoteGlyphCache_DEFINED

#include <memory>
#include <vector>

#include "include/core/SkData.h"
#include "include/core/SkRefCnt.h"
#include "include/utils/SkNoDrawCanvas.h"

class SkAutoDescriptor;
struct SkPackedGlyphID;
class SkStrikeCache;
class SkStrikeClientImpl;
class SkStrikeServer;
class SkStrikeServerImpl;
class SkTypeface;

using SkDiscardableHandleId = uint32_t;
// This class is not thread-safe.
class SkStrikeServer {
public:
    // An interface used by the server to create handles for pinning SkStrike
    // entries on the remote client.
    class DiscardableHandleManager {
    public:
        SK_SPI virtual ~DiscardableHandleManager() = default;

        // Creates a new *locked* handle and returns a unique ID that can be used to identify
        // it on the remote client.
        SK_SPI virtual SkDiscardableHandleId createHandle() = 0;

        // Returns true if the handle could be successfully locked. The server can
        // assume it will remain locked until the next set of serialized entries is
        // pulled from the SkStrikeServer.
        // If returns false, the cache entry mapped to the handle has been deleted
        // on the client. Any subsequent attempts to lock the same handle are not
        // allowed.
        SK_SPI virtual bool lockHandle(SkDiscardableHandleId) = 0;

        // Returns true if a handle has been deleted on the remote client. It is
        // invalid to use a handle id again with this manager once this returns true.
        SK_SPI virtual bool isHandleDeleted(SkDiscardableHandleId) = 0;
    };

    SK_SPI explicit SkStrikeServer(DiscardableHandleManager* discardableHandleManager);
    SK_SPI ~SkStrikeServer();

    // Create an analysis SkCanvas used to populate the SkStrikeServer with ops
    // which will be serialized and rendered using the SkStrikeClient.
    SK_API std::unique_ptr<SkCanvas> makeAnalysisCanvas(int width, int height,
                                                        const SkSurfaceProps& props,
                                                        sk_sp<SkColorSpace> colorSpace,
                                                        bool DFTSupport);

    // Serializes the typeface to be transmitted using this server.
    SK_SPI sk_sp<SkData> serializeTypeface(SkTypeface*);

    // Serializes the strike data captured using a canvas returned by ::makeAnalysisCanvas. Any
    // handles locked using the DiscardableHandleManager will be assumed to be
    // unlocked after this call.
    SK_SPI void writeStrikeData(std::vector<uint8_t>* memory);

    // Testing helpers
    void setMaxEntriesInDescriptorMapForTesting(size_t count);
    size_t remoteStrikeMapSizeForTesting() const;

private:
    SkStrikeServerImpl* impl();

    std::unique_ptr<SkStrikeServerImpl> fImpl;
};

class SkStrikeClient {
public:
    // This enum is used in histogram reporting in chromium. Please don't re-order the list of
    // entries, and consider it to be append-only.
    enum CacheMissType : uint32_t {
        // Hard failures where no fallback could be found.
        kFontMetrics = 0,
        kGlyphMetrics = 1,
        kGlyphImage = 2,
        kGlyphPath = 3,

        // (DEPRECATED) The original glyph could not be found and a fallback was used.
        kGlyphMetricsFallback = 4,
        kGlyphPathFallback    = 5,

        kLast = kGlyphPath
    };

    // An interface to delete handles that may be pinned by the remote server.
    class DiscardableHandleManager : public SkRefCnt {
    public:
        ~DiscardableHandleManager() override = default;

        // Returns true if the handle was unlocked and can be safely deleted. Once
        // successful, subsequent attempts to delete the same handle are invalid.
        virtual bool deleteHandle(SkDiscardableHandleId) = 0;

        virtual void notifyCacheMiss(CacheMissType type, int fontSize) = 0;

        struct ReadFailureData {
            size_t memorySize;
            size_t bytesRead;
            uint64_t typefaceSize;
            uint64_t strikeCount;
            uint64_t glyphImagesCount;
            uint64_t glyphPathsCount;
        };
        virtual void notifyReadFailure(const ReadFailureData& data) {}
    };

    SK_SPI explicit SkStrikeClient(sk_sp<DiscardableHandleManager>,
                                   bool isLogging = true,
                                   SkStrikeCache* strikeCache = nullptr);
    SK_SPI ~SkStrikeClient();

    // Deserializes the typeface previously serialized using the SkStrikeServer. Returns null if the
    // data is invalid.
    SK_SPI sk_sp<SkTypeface> deserializeTypeface(const void* data, size_t length);

    // Deserializes the strike data from a SkStrikeServer. All messages generated
    // from a server when serializing the ops must be deserialized before the op
    // is rasterized.
    // Returns false if the data is invalid.
    SK_SPI bool readStrikeData(const volatile void* memory, size_t memorySize);

private:
    std::unique_ptr<SkStrikeClientImpl> fImpl;
};

// For exposure to fuzzing only.
bool SkFuzzDeserializeSkDescriptor(sk_sp<SkData> bytes, SkAutoDescriptor* ad);

#endif  // SkChromeRemoteGlyphCache_DEFINED
