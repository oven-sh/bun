#pragma once

// RFC 6455 message codec for a WebSocket carried on one multiplexed request
// stream (RFC 8441 / RFC 9220). It reuses the uWebSockets frame parser and
// formatter, permessage-deflate negotiation and streams, and a per-transport
// TopicTree. Only stream I/O is transport specific; `Transport` supplies it as
// static functions over its response type:
//
//   using Response;
//   bool isWritable(Response*);                     // may still send frames
//   size_t bufferedAmount(Response*);               // bytes waiting in our buffer
//   size_t backpressureMemory(Response*);           // heap held by that buffer
//   size_t frameBudget(size_t frameLength, size_t payloadLength);
//                                                   // frame bytes + write framing
//   bool canWriteWithinBackpressure(Response*, size_t budget, size_t maxBackpressure);
//   bool write(Response*, std::string_view);        // false = now backpressured
//   bool tryWriteFrame(Response*, std::string_view header, std::string_view payload);
//                                                   // all-or-nothing fast path
//   void cancel(Response*);                         // abort the stream
//   void writeHeader(Response*, std::string_view, std::string_view);
//   uWS::StreamTopicTree* topics(Response*);
//   void scheduleTopicDrain(Response*);             // after a queued publish
//   uWS::LoopData* loopData(Response*);

#include "PaddedWebSocketProtocol.h"

#include <bun-uws/src/LoopData.h>
#include <bun-uws/src/PerMessageDeflate.h>
#include <bun-uws/src/StreamWebSocketTopics.h>
#include <bun-uws/src/WebSocketExtensions.h>

#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace Bun {

template<typename Transport>
struct StreamWebSocketParser : PaddedWebSocketProtocol<true, StreamWebSocketParser<Transport>, 9> {
    using Response = typename Transport::Response;

    using FragmentHandler = bool (*)(void*, const char*, size_t, unsigned int, int, bool);
    using FailHandler = void (*)(void*, int);

    static constexpr size_t INFLATION_POST_PADDING = 9;

    Response* response;
    size_t maxPayloadLength;
    size_t maxBackpressure;
    bool closeOnBackpressureLimit;
    void* user;
    FragmentHandler fragmentHandler;
    FailHandler failHandler;
    std::vector<char> compressedFragments;
    std::vector<char> sendScratch;
    uWS::CompressOptions compressionOptions = uWS::CompressOptions::DISABLED;
    enum CompressionStatus : uint8_t {
        DISABLED,
        ENABLED,
        COMPRESSED_FRAME,
    } compressionStatus = DISABLED;
    uWS::DeflationStream* deflationStream = nullptr;
    uWS::InflationStream* inflationStream = nullptr;
    bool failed = false;
    uWS::Subscriber* subscriber = nullptr;
    uWS::StreamTopicSubscriber topicAdapter;

    StreamWebSocketParser(Response* response, size_t maxPayloadLength, size_t maxBackpressure, bool closeOnBackpressureLimit,
        void* user, FragmentHandler fragmentHandler, FailHandler failHandler)
        : response(response)
        , maxPayloadLength(maxPayloadLength)
        , maxBackpressure(maxBackpressure)
        , closeOnBackpressureLimit(closeOnBackpressureLimit)
        , user(user)
        , fragmentHandler(fragmentHandler)
        , failHandler(failHandler)
    {
        topicAdapter.user = this;
        topicAdapter.send = [](void* opaque, const char* data, size_t length, int opCode, bool compress, bool* limitExceeded) -> uint32_t {
            auto* parser = static_cast<StreamWebSocketParser*>(opaque);
            return parser->send(data, length, opCode, compress, true, parser->maxBackpressure, limitExceeded);
        };
        topicAdapter.buffered = [](void* opaque) -> size_t {
            auto* parser = static_cast<StreamWebSocketParser*>(opaque);
            return parser->response ? Transport::bufferedAmount(parser->response) : uWS::STREAM_TOPIC_SUBSCRIBER_GONE;
        };
        topicAdapter.maxBackpressure = maxBackpressure;
        if (closeOnBackpressureLimit) {
            topicAdapter.close = [](void* opaque) {
                auto* parser = static_cast<StreamWebSocketParser*>(opaque);
                if (parser->response) Transport::cancel(parser->response);
            };
        }
    }

    ~StreamWebSocketParser()
    {
        unsubscribeAll();
        delete deflationStream;
        delete inflationStream;
    }

    uWS::TopicTree<uWS::TopicTreeMessage, uWS::TopicTreeBigMessage>* topics() const
    {
        return response ? Transport::topics(response) : nullptr;
    }

    bool subscribe(std::string_view topic)
    {
        auto* tree = topics();
        if (!tree) return false;
        if (!subscriber) {
            subscriber = tree->createSubscriber();
            subscriber->user = &topicAdapter;
        }
        tree->subscribe(subscriber, topic);
        /* Match the long-standing ServerWebSocket contract: subscribing is
         * idempotent and reports success even when this subscriber already
         * belongs to the topic. */
        return true;
    }

    bool unsubscribe(std::string_view topic)
    {
        auto* tree = topics();
        if (!tree || !subscriber) return false;
        auto [ok, last] = tree->unsubscribe(subscriber, topic);
        if (ok && last) {
            tree->drain(subscriber);
            tree->freeSubscriber(subscriber);
            subscriber = nullptr;
        }
        return ok;
    }

    bool isSubscribed(std::string_view topic) const
    {
        auto* tree = topics();
        if (!tree || !subscriber) return false;
        auto* topicPtr = tree->lookupTopic(topic);
        return topicPtr && topicPtr->count(subscriber);
    }

    void unsubscribeAll()
    {
        if (!subscriber) return;
        auto* tree = topics();
        if (tree)
            tree->freeSubscriber(subscriber);
        else
            delete subscriber;
        subscriber = nullptr;
    }

    template<typename Callback>
    void iterateTopics(Callback&& callback) const
    {
        if (!subscriber) return;
        for (auto* topic : subscriber->topics)
            callback(std::string_view(topic->name));
    }

    uint32_t publish(std::string_view topic, std::string_view message, int opCode, bool compress)
    {
        bool queued = false;
        uint32_t status = uWS::publishToStreamTopic(topics(), subscriber, topic, message, opCode, compress, queued);
        if (queued && response) Transport::scheduleTopicDrain(response);
        return status;
    }

    uWS::LoopData* loopData() const
    {
        return Transport::loopData(response);
    }

    void ensureCompressionResources()
    {
        uWS::LoopData* ld = loopData();
        if (!ld->zlibContext) {
            ld->zlibContext = new uWS::ZlibContext;
            ld->inflationStream = new uWS::InflationStream(uWS::CompressOptions::DEDICATED_DECOMPRESSOR);
            ld->deflationStream = new uWS::DeflationStream(uWS::CompressOptions::DEDICATED_COMPRESSOR);
        }
    }

    void negotiateCompression(uint16_t configured, std::string_view offer)
    {
        if (!configured || offer.empty()) return;
        uWS::CompressOptions wanted = (uWS::CompressOptions)configured;

        int wantedInflationWindow = 0;
        if ((wanted & uWS::CompressOptions::_DECOMPRESSOR_MASK) != uWS::CompressOptions::SHARED_DECOMPRESSOR) {
            wantedInflationWindow = (wanted & uWS::CompressOptions::_DECOMPRESSOR_MASK) >> 8;
        }
        int wantedCompressionWindow = (wanted & uWS::CompressOptions::_COMPRESSOR_MASK) >> 4;

        auto [negotiated, compressionWindow, inflationWindow, responseHeader] = uWS::negotiateCompression(true, wantedCompressionWindow, wantedInflationWindow, offer);
        if (!negotiated) return;

        if (compressionWindow == 0) {
            compressionOptions = uWS::CompressOptions::SHARED_COMPRESSOR;
        } else {
            compressionOptions = (uWS::CompressOptions)((uint32_t)(compressionWindow << 4)
                | (uint32_t)(compressionWindow - 7));
            /* Preserve the 3 KB memLevel selection, whose windowBits value is
             * otherwise indistinguishable from the 4 KB option. */
            if ((wanted & uWS::CompressOptions::_COMPRESSOR_MASK) == uWS::CompressOptions::DEDICATED_COMPRESSOR_3KB) {
                compressionOptions = uWS::CompressOptions::DEDICATED_COMPRESSOR_3KB;
            }
        }
        if (inflationWindow == 0) {
            compressionOptions = (uWS::CompressOptions)(compressionOptions | uWS::CompressOptions::SHARED_DECOMPRESSOR);
        } else {
            compressionOptions = (uWS::CompressOptions)(compressionOptions | (inflationWindow << 8));
        }

        ensureCompressionResources();
        if ((compressionOptions & uWS::CompressOptions::_COMPRESSOR_MASK) != uWS::CompressOptions::SHARED_COMPRESSOR) {
            deflationStream = new uWS::DeflationStream(compressionOptions);
        }
        if ((compressionOptions & uWS::CompressOptions::_DECOMPRESSOR_MASK) != uWS::CompressOptions::SHARED_DECOMPRESSOR) {
            inflationStream = new uWS::InflationStream(compressionOptions);
        }
        compressionStatus = ENABLED;
        Transport::writeHeader(response, "sec-websocket-extensions", responseHeader);
    }

    static bool setCompressed(uWS::WebSocketState<true>*, void* opaque)
    {
        StreamWebSocketParser* parser = (StreamWebSocketParser*)opaque;
        if (parser->compressionStatus == DISABLED) return false;
        parser->compressionStatus = COMPRESSED_FRAME;
        return true;
    }

    static bool refusePayloadLength(uint64_t length, uWS::WebSocketState<true>*, void* opaque)
    {
        return length > ((StreamWebSocketParser*)opaque)->maxPayloadLength;
    }

    static void forceClose(uWS::WebSocketState<true>*, void* opaque, std::string_view reason = {})
    {
        StreamWebSocketParser* parser = (StreamWebSocketParser*)opaque;
        if (parser->failed) return;
        parser->failed = true;
        int code = (reason == uWS::ERR_TOO_BIG_MESSAGE || reason == uWS::ERR_TOO_BIG_MESSAGE_INFLATION) ? 1009 : 1002;
        parser->failHandler(parser->user, code);
    }

    static bool handleFragment(char* data, size_t length, unsigned int remainingBytes, int opCode, bool fin,
        uWS::WebSocketState<true>*, void* opaque)
    {
        StreamWebSocketParser* parser = (StreamWebSocketParser*)opaque;
        if (opCode < 3 && parser->compressionStatus == COMPRESSED_FRAME) {
            size_t aggregate = parser->compressedFragments.size() + length;
            if (aggregate > parser->maxPayloadLength) {
                forceClose(parser, opaque, uWS::ERR_TOO_BIG_MESSAGE);
                return true;
            }
            if (remainingBytes || !fin || !parser->compressedFragments.empty()) {
                parser->compressedFragments.insert(parser->compressedFragments.end(), data, data + length);
                if (remainingBytes || !fin) return false;
                /* InflationStream writes a four/nine-byte DEFLATE tail beyond
                 * the supplied view.  Keep that padding owned and mutable. */
                parser->compressedFragments.resize(parser->compressedFragments.size() + INFLATION_POST_PADDING);
                data = parser->compressedFragments.data();
                length = parser->compressedFragments.size() - INFLATION_POST_PADDING;
            }

            uWS::LoopData* ld = parser->loopData();
            uWS::InflationResult inflated = parser->inflationStream
                ? parser->inflationStream->inflateWithStatus(ld->zlibContext, { data, length }, parser->maxPayloadLength, false)
                : ld->inflationStream->inflateWithStatus(ld->zlibContext, { data, length }, parser->maxPayloadLength, true);
            parser->compressionStatus = ENABLED;
            parser->compressedFragments.clear();
            if (inflated.status != uWS::InflationStatus::SUCCESS) {
                parser->failed = true;
                parser->failHandler(parser->user,
                    inflated.status == uWS::InflationStatus::TOO_LARGE ? 1009 : 1007);
                return true;
            }
            return parser->fragmentHandler(parser->user, inflated.data.data(), inflated.data.size(), 0, opCode, true);
        }
        return parser->failed || parser->fragmentHandler(parser->user, data, length, remainingBytes, opCode, fin);
    }

    uint32_t send(const char* data, size_t length, int opCode, bool compress, bool fin,
        size_t maxBackpressure, bool* limitExceeded)
    {
        *limitExceeded = false;
        if (!response || !Transport::isWritable(response)) return 2;

        /* Preserve the established uWS ordering guarantee: publications
         * queued for this subscriber are emitted before a following direct
         * send on the same WebSocket. TopicTree clears needsDrainage before
         * invoking this method from its callback, so this is not recursive. */
        if (subscriber) {
            if (auto* tree = topics()) tree->drain(subscriber);
        }

        std::string_view message { data, length };
        compress = compress && length && fin && opCode > 0 && opCode < 3 && compressionStatus != DISABLED;
        bool compressedTransactionally = false;
        if (compress && deflationStream && maxBackpressure) {
            /* A dedicated compressor carries context into the next message.
             * Never mutate that state and then drop the result: conservatively
             * reserve this stream's parameter-aware Z_SYNC_FLUSH bound before
             * compression. */
            std::optional<size_t> maybeBound = deflationStream->maxSizeForSyncFlush(length);
            if (!maybeBound) {
                *limitExceeded = true;
                return 2;
            }
            size_t bound = *maybeBound;
            size_t boundFrameLength = uWS::protocol::messageFrameSize(bound);
            size_t boundBudgetLength = Transport::frameBudget(boundFrameLength, bound);
            if (boundFrameLength < bound || boundBudgetLength < boundFrameLength
                || !Transport::canWriteWithinBackpressure(response, boundBudgetLength, maxBackpressure)) {
                /* The worst-case bound may be much larger than the actual
                 * compressed frame. Clone the takeover state on this slow
                 * path, then commit it only when the exact output fits. */
                uWS::LoopData* ld = loopData();
                auto candidate = deflationStream->clone();
                if (!candidate) {
                    *limitExceeded = true;
                    return 2;
                }
                std::string_view staged = candidate->deflate(ld->zlibContext, message, false);
                size_t stagedFrameLength = uWS::protocol::messageFrameSize(staged.size());
                size_t stagedBudgetLength = Transport::frameBudget(stagedFrameLength, staged.size());
                if (stagedFrameLength < staged.size() || stagedBudgetLength < stagedFrameLength
                    || !Transport::canWriteWithinBackpressure(response, stagedBudgetLength, maxBackpressure)) {
                    *limitExceeded = true;
                    return 2;
                }

                /* The compressed bytes belong to ZlibContext, not the stream
                 * object. Replacing the heap object therefore commits the
                 * dictionary without invalidating the output view. */
                delete deflationStream;
                deflationStream = candidate.release();
                message = staged;
                compressedTransactionally = true;
            }
        }
        if (compress && !compressedTransactionally) {
            uWS::LoopData* ld = loopData();
            message = deflationStream
                ? deflationStream->deflate(ld->zlibContext, message, false)
                : ld->deflationStream->deflate(ld->zlibContext, message, true);
        }

        size_t frameLength = uWS::protocol::messageFrameSize(message.size());
        bool splitLargeFrame = message.size() >= 16 * 1024;
        /* frameBudget() adds any per-write transport framing the split path
         * below introduces, keeping the preflight conservative and the
         * per-stream maxBackpressure promise exact. */
        size_t budgetLength = Transport::frameBudget(frameLength, message.size());
        if (budgetLength < frameLength || !Transport::canWriteWithinBackpressure(response, budgetLength, maxBackpressure)) {
            *limitExceeded = true;
            /* Stateful compression has already advanced. The bound above
             * makes this unreachable for a live, unchanged response, but if
             * that invariant is ever broken, retire this tunnel rather than
             * continue with a context the peer did not receive. */
            if (compress && deflationStream) Transport::cancel(response);
            return 2;
        }
        /* Match the established H1 optimization: a large server frame does
         * not need a contiguous header+payload copy. RFC 6455 frame
         * boundaries are independent of the transport's DATA-frame boundaries,
         * and Transport::write preserves byte order while copying any
         * flow-controlled remainder into its bounded backpressure buffer. */
        if (splitLargeFrame) {
            char header[10];
            size_t headerLength = uWS::protocol::formatMessage<true>(header, "", 0,
                (uWS::OpCode)opCode, message.size(), compress, fin);
            bool headerWritten = Transport::write(response, { header, headerLength });
            bool payloadWritten = Transport::write(response, message);
            return headerWritten && payloadWritten ? 1 : 0;
        }

        char header[10];
        size_t headerLength = uWS::protocol::formatMessage<true>(header, "", 0,
            (uWS::OpCode)opCode, message.size(), compress, fin);
        if (Transport::tryWriteFrame(response, { header, headerLength }, message)) return 1;

        sendScratch.resize(frameLength);
        uWS::protocol::formatMessage<true>(sendScratch.data(), message.data(), message.size(),
            (uWS::OpCode)opCode, message.size(), compress, fin);
        return Transport::write(response, { sendScratch.data(), sendScratch.size() }) ? 1 : 0;
    }

    size_t memoryCost() const
    {
        return sizeof(StreamWebSocketParser) + this->paddedConsumeMemoryCost() + compressedFragments.capacity() + sendScratch.capacity()
            + (response ? Transport::backpressureMemory(response) : 0);
    }

    void consume(const char* data, size_t length)
    {
        if (!failed) this->consumePadded(data, length);
    }
};

}
