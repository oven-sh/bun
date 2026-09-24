// HTTP/2 C ABI. Mirrors libuwsockets_h3.cpp 1:1 (same parameter shapes,
// same callback signatures) so the Rust side pattern-matches the H3 surface.
// Requests are uWS::Http3Request (the shared decoded-header-list request),
// so the uws_h3_req_* functions serve HTTP/2 too; only app and response
// entry points live here.

// clang-format off
#include "_libusockets.h"
#include "PaddedWebSocketProtocol.h"

#include <bun-uws/src/Http2App.h>
#include <bun-uws/src/PerMessageDeflate.h>
#include <bun-uws/src/WebSocketExtensions.h>
#include <vector>
#include <string_view>
#include <string.h>
// clang-format on

using uWS::H2App;
using uWS::Http2Request;
using uWS::Http2Response;
using uWS::Http2ResponseData;

static inline std::string_view h2sv(const char* p, size_t n) { return p ? std::string_view { p, n } : std::string_view {}; }

struct H2WebSocketParser : Bun::PaddedWebSocketProtocol<true, H2WebSocketParser, 9> {
    using FragmentHandler = bool (*)(void*, const char*, size_t, unsigned int, int, bool);
    using FailHandler = void (*)(void*, int);

    static constexpr size_t INFLATION_POST_PADDING = 9;

    Http2Response* response;
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
    uWS::Http2TopicSubscriber topicAdapter;

    H2WebSocketParser(Http2Response* response, size_t maxPayloadLength, size_t maxBackpressure, bool closeOnBackpressureLimit,
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
            auto* parser = static_cast<H2WebSocketParser*>(opaque);
            return parser->send(data, length, opCode, compress, true, parser->maxBackpressure, limitExceeded);
        };
        topicAdapter.buffered = [](void* opaque) -> size_t {
            auto* parser = static_cast<H2WebSocketParser*>(opaque);
            return parser->response ? parser->response->getBufferedAmount() : 0;
        };
        topicAdapter.maxBackpressure = maxBackpressure;
        if (closeOnBackpressureLimit) {
            topicAdapter.close = [](void* opaque) {
                auto* parser = static_cast<H2WebSocketParser*>(opaque);
                if (parser->response && !parser->response->dead) parser->response->close(uWS::http2::ERR_CANCEL);
            };
        }
    }

    ~H2WebSocketParser()
    {
        unsubscribeAll();
        delete deflationStream;
        delete inflationStream;
    }

    uWS::TopicTree<uWS::TopicTreeMessage, uWS::TopicTreeBigMessage>* topics() const
    {
        return response && response->conn && response->conn->ctx ? response->conn->ctx->topicTree : nullptr;
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
        auto* tree = topics();
        if (!tree) return 2;
        if (message.size() >= uWS::LoopData::CORK_BUFFER_SIZE) {
            bool hasReceivers = false;
            uint32_t worst = 1;
            tree->publishBig(subscriber, topic, { message, opCode, compress }, [&](uWS::Subscriber* s, uWS::TopicTreeBigMessage& item) {
                hasReceivers = true;
                auto* adapter = static_cast<uWS::Http2TopicSubscriber*>(s->user);
                bool limitExceeded = false;
                uint32_t status = adapter && adapter->send ? adapter->send(adapter->user, item.message.data(), item.message.size(), item.opCode, item.compress, &limitExceeded) : 2;
                if (limitExceeded && adapter && adapter->close) adapter->close(adapter->user);
                if (status == 2 || (status == 0 && worst == 1)) worst = status;
            });
            return hasReceivers ? worst : 2;
        }
        auto* topicPtr = tree->lookupTopic(topic);
        if (!topicPtr) return 2;
        bool queued = tree->publish(subscriber, *topicPtr, { std::string(message), opCode, compress });
        if (queued && response && response->conn && response->conn->ctx) {
            response->conn->ctx->scheduleDeferredDrain();
        }
        bool hasReceivers = false;
        uint32_t worst = 1;
        for (auto* s : *topicPtr) {
            if (s == subscriber) continue;
            hasReceivers = true;
            auto* adapter = static_cast<uWS::Http2TopicSubscriber*>(s->user);
            auto* peer = adapter ? static_cast<H2WebSocketParser*>(adapter->user) : nullptr;
            if (!peer || !peer->response) {
                worst = 2;
                continue;
            }
            size_t buffered = peer->response->getBufferedAmount();
            if (peer->maxBackpressure && buffered > peer->maxBackpressure)
                worst = 2;
            else if (buffered && worst == 1)
                worst = 0;
        }
        return hasReceivers ? worst : 2;
    }

    uWS::LoopData* loopData() const
    {
        return (uWS::LoopData*)us_loop_ext(us_socket_group_loop(us_socket_group(response->conn->s)));
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
        response->writeHeader("sec-websocket-extensions", responseHeader);
    }

    static bool setCompressed(uWS::WebSocketState<true>*, void* opaque)
    {
        H2WebSocketParser* parser = (H2WebSocketParser*)opaque;
        if (parser->compressionStatus == DISABLED) return false;
        parser->compressionStatus = COMPRESSED_FRAME;
        return true;
    }

    static bool refusePayloadLength(uint64_t length, uWS::WebSocketState<true>*, void* opaque)
    {
        return length > ((H2WebSocketParser*)opaque)->maxPayloadLength;
    }

    static void forceClose(uWS::WebSocketState<true>*, void* opaque, std::string_view reason = {})
    {
        H2WebSocketParser* parser = (H2WebSocketParser*)opaque;
        if (parser->failed) return;
        parser->failed = true;
        int code = (reason == uWS::ERR_TOO_BIG_MESSAGE || reason == uWS::ERR_TOO_BIG_MESSAGE_INFLATION) ? 1009 : 1002;
        parser->failHandler(parser->user, code);
    }

    static bool handleFragment(char* data, size_t length, unsigned int remainingBytes, int opCode, bool fin,
        uWS::WebSocketState<true>*, void* opaque)
    {
        H2WebSocketParser* parser = (H2WebSocketParser*)opaque;
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
        if (!response || response->dead || response->localClosed) return 2;

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
            size_t boundBudgetLength = boundFrameLength + (bound >= 16 * 1024 ? uWS::http2::FRAME_HEADER_SIZE : 0);
            if (boundFrameLength < bound || boundBudgetLength < boundFrameLength
                || !response->canWriteWithinBackpressure(boundBudgetLength, maxBackpressure)) {
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
                size_t stagedBudgetLength = stagedFrameLength
                    + (staged.size() >= 16 * 1024 ? uWS::http2::FRAME_HEADER_SIZE : 0);
                if (stagedFrameLength < staged.size() || stagedBudgetLength < stagedFrameLength
                    || !response->canWriteWithinBackpressure(stagedBudgetLength, maxBackpressure)) {
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
        /* The split path emits one extra H2 DATA header. sendAllowance()
         * includes the connection output high-water mark, so account for that
         * bounded overhead to keep the preflight conservative and the
         * per-stream maxBackpressure promise exact. */
        size_t budgetLength = frameLength + (splitLargeFrame ? uWS::http2::FRAME_HEADER_SIZE : 0);
        if (budgetLength < frameLength || !response->canWriteWithinBackpressure(budgetLength, maxBackpressure)) {
            *limitExceeded = true;
            /* Stateful compression has already advanced. The bound above
             * makes this unreachable for a live, unchanged response, but if
             * that invariant is ever broken, retire this tunnel rather than
             * continue with a context the peer did not receive. */
            if (compress && deflationStream) response->close(uWS::http2::ERR_CANCEL);
            return 2;
        }
        /* Match the established H1 optimization: a large server frame does
         * not need a contiguous header+payload copy. RFC 6455 frame
         * boundaries are independent of HTTP/2 DATA-frame boundaries, and
         * Http2Response::write preserves byte order while copying any
         * flow-controlled remainder into its bounded backpressure buffer. */
        if (splitLargeFrame) {
            char header[10];
            size_t headerLength = uWS::protocol::formatMessage<true>(header, "", 0,
                (uWS::OpCode)opCode, message.size(), compress, fin);
            bool headerWritten = response->write({ header, headerLength });
            bool payloadWritten = response->write(message);
            return headerWritten && payloadWritten ? 1 : 0;
        }

        char header[10];
        size_t headerLength = uWS::protocol::formatMessage<true>(header, "", 0,
            (uWS::OpCode)opCode, message.size(), compress, fin);
        if (response->tryWriteWebSocketFrame({ header, headerLength }, message)) return 1;

        sendScratch.resize(frameLength);
        uWS::protocol::formatMessage<true>(sendScratch.data(), message.data(), message.size(),
            (uWS::OpCode)opCode, message.size(), compress, fin);
        return response->write({ sendScratch.data(), sendScratch.size() }) ? 1 : 0;
    }

    size_t memoryCost() const
    {
        return sizeof(H2WebSocketParser) + paddedConsumeMemoryCost() + compressedFragments.capacity() + sendScratch.capacity()
            + (response ? response->data.backpressure.totalLength() : 0);
    }

    void consume(const char* data, size_t length)
    {
        if (!failed) consumePadded(data, length);
    }
};

extern "C" {

#pragma clang attribute push(__attribute__((always_inline)), apply_to = function)

typedef struct uws_app_s uws_app_t;
typedef struct uws_h2_app_s uws_h2_app_t;
typedef struct uws_h2_res_s uws_h2_res_t;
typedef struct uws_h3_req_s uws_h3_req_t;
typedef struct uws_h2_ws_parser_s uws_h2_ws_parser_t;

typedef void (*uws_h2_method_handler)(uws_h2_res_t*, uws_h3_req_t*, void*);

uws_h2_ws_parser_t* uws_h2_ws_parser_create(uws_h2_res_t* response, size_t max_payload_length,
    size_t max_backpressure, bool close_on_backpressure_limit, uint16_t compression,
    const char* extension_offer, size_t extension_offer_length, void* user,
    bool (*fragment_handler)(void*, const char*, size_t, unsigned int, int, bool),
    void (*fail_handler)(void*, int))
{
    if (!response || !fragment_handler || !fail_handler) return nullptr;
    H2WebSocketParser* parser = new H2WebSocketParser((Http2Response*)response, max_payload_length, max_backpressure,
        close_on_backpressure_limit, user, fragment_handler, fail_handler);
    parser->negotiateCompression(compression, h2sv(extension_offer, extension_offer_length));
    if (!((Http2Response*)response)->upgradeToWebSocket()) {
        delete parser;
        return nullptr;
    }
    return (uws_h2_ws_parser_t*)parser;
}

void uws_h2_ws_parser_consume(uws_h2_ws_parser_t* parser, const char* data, size_t length)
{
    if (parser) ((H2WebSocketParser*)parser)->consume(data, length);
}

void uws_h2_ws_parser_destroy(uws_h2_ws_parser_t* parser)
{
    delete (H2WebSocketParser*)parser;
}

uint32_t uws_h2_ws_send(uws_h2_ws_parser_t* parser, const char* data, size_t length,
    int op_code, bool compress, bool fin, size_t max_backpressure, bool* limit_exceeded)
{
    if (!parser || !limit_exceeded) return 2;
    return ((H2WebSocketParser*)parser)->send(data, length, op_code, compress, fin, max_backpressure, limit_exceeded);
}

size_t uws_h2_ws_parser_memory_cost(uws_h2_ws_parser_t* parser)
{
    return parser ? ((H2WebSocketParser*)parser)->memoryCost() : 0;
}

bool uws_h2_ws_subscribe(uws_h2_ws_parser_t* parser, const char* topic, size_t length)
{
    return parser && ((H2WebSocketParser*)parser)->subscribe(h2sv(topic, length));
}

bool uws_h2_ws_unsubscribe(uws_h2_ws_parser_t* parser, const char* topic, size_t length)
{
    return parser && ((H2WebSocketParser*)parser)->unsubscribe(h2sv(topic, length));
}

bool uws_h2_ws_is_subscribed(uws_h2_ws_parser_t* parser, const char* topic, size_t length)
{
    return parser && ((H2WebSocketParser*)parser)->isSubscribed(h2sv(topic, length));
}

uint32_t uws_h2_ws_publish(uws_h2_ws_parser_t* parser, const char* topic, size_t topic_length,
    const char* data, size_t data_length, int op_code, bool compress)
{
    return parser ? ((H2WebSocketParser*)parser)->publish(h2sv(topic, topic_length), h2sv(data, data_length), op_code, compress) : 2;
}

void uws_h2_ws_get_topics(uws_h2_ws_parser_t* parser, void (*callback)(void*, const char*, size_t), void* user)
{
    if (!parser || !callback) return;
    ((H2WebSocketParser*)parser)->iterateTopics([&](std::string_view topic) { callback(user, topic.data(), topic.size()); });
}

void uws_h2_ws_unsubscribe_all(uws_h2_ws_parser_t* parser)
{
    if (parser) ((H2WebSocketParser*)parser)->unsubscribeAll();
}

/* ───── app ───── */

uws_h2_app_t* uws_h2_create_app(int ssl, uws_app_t* parent, bool allow_http1, unsigned int idle_timeout_s, bool enable_connect_protocol)
{
    if (ssl) {
        return (uws_h2_app_t*)H2App::create((uWS::TemplatedApp<true>*)parent, allow_http1, idle_timeout_s, enable_connect_protocol);
    }
    return (uws_h2_app_t*)H2App::create((uWS::TemplatedApp<false>*)parent, allow_http1, idle_timeout_s, enable_connect_protocol);
}

void uws_h2_app_destroy(uws_h2_app_t* app)
{
    if (app) ((H2App*)app)->destroy();
}
void uws_h2_app_on_schedule_drain(uws_h2_app_t* app, void (*cb)(void*, void*), void* user) { ((H2App*)app)->onScheduleDrain((void (*)(void*, uWS::Http2Context*))cb, user); }
bool uws_h2_app_drain(uws_h2_app_t* app) { return ((H2App*)app)->drain(); }
void uws_h2_app_cancel_drain(uws_h2_app_t* app) { ((H2App*)app)->cancelDrain(); }
void uws_h2_app_close(uws_h2_app_t* app) { ((H2App*)app)->close(); }
void uws_h2_app_clear_routes(uws_h2_app_t* app) { ((H2App*)app)->clearRoutes(); }
uint32_t uws_h2_app_publish(uws_h2_app_t* app, const char* topic, size_t topic_length,
    const char* data, size_t data_length, int op_code, bool compress)
{
    return app ? ((H2App*)app)->publish(h2sv(topic, topic_length), h2sv(data, data_length), op_code, compress) : 2;
}

unsigned int uws_h2_app_num_subscribers(uws_h2_app_t* app, const char* topic, size_t topic_length)
{
    return app ? ((H2App*)app)->numSubscribers(h2sv(topic, topic_length)) : 0;
}

#define H2_ROUTE(name, method)                                                                         \
    void uws_h2_app_##name(uws_h2_app_t* app, const char* pattern, size_t pattern_len,                 \
        uws_h2_method_handler handler, void* user_data)                                                \
    {                                                                                                  \
        if (handler == nullptr) return;                                                                \
        ((H2App*)app)->method(h2sv(pattern, pattern_len), [handler, user_data](auto* res, auto* req) { \
            handler((uws_h2_res_t*)res, (uws_h3_req_t*)req, user_data);                                \
        });                                                                                            \
    }
H2_ROUTE(get, get)
H2_ROUTE(post, post)
H2_ROUTE(options, options)
H2_ROUTE(delete, del)
H2_ROUTE(patch, patch)
H2_ROUTE(put, put)
H2_ROUTE(head, head)
H2_ROUTE(connect, connect)
H2_ROUTE(trace, trace)
H2_ROUTE(any, any)
#undef H2_ROUTE

/* ───── response ───── */

int uws_h2_res_state(uws_h2_res_t* res) { return ((Http2Response*)res)->getHttpResponseData()->state; }

void uws_h2_res_end(uws_h2_res_t* res, const char* data, size_t length, bool close_connection)
{
    Http2Response* r = (Http2Response*)res;
    r->clearOnWritableAndAborted();
    r->end(h2sv(data, length), close_connection);
}

void uws_h2_res_end_stream(uws_h2_res_t* res, bool close_connection)
{
    Http2Response* r = (Http2Response*)res;
    r->clearOnWritableAndAborted();
    r->sendTerminatingChunk(close_connection);
}

bool uws_h2_res_is_closed(uws_h2_res_t* res) { return ((Http2Response*)res)->dead; }

/* END_STREAM on the request HEADERS, or content-length: 0 (declaredContentLength is -1 when absent). */
bool uws_h2_res_request_body_ended(uws_h2_res_t* res)
{
    Http2Response* r = (Http2Response*)res;
    /* Content-Length describes an ordinary request body, not the bytes in an
     * RFC 8441 tunnel.  Only END_STREAM makes an Extended CONNECT one-way. */
    return r->remoteClosed || (!r->websocketConnect && r->declaredContentLength == 0);
}

bool uws_h2_res_is_connect_request(uws_h2_res_t* res)
{
    return ((Http2Response*)res)->isConnectRequest();
}

bool uws_h2_res_is_websocket_connect(uws_h2_res_t* res)
{
    return ((Http2Response*)res)->isWebSocketConnectRequest();
}

bool uws_h2_res_upgrade_websocket(uws_h2_res_t* res)
{
    return ((Http2Response*)res)->upgradeToWebSocket();
}

/* Server-side failure after the response started (a body stream errored,
 * a file read failed): the peer sees INTERNAL_ERROR, not a cancel. */
void uws_h2_res_force_close(uws_h2_res_t* res)
{
    Http2Response* r = (Http2Response*)res;
    r->clearOnWritableAndAborted();
    r->close(uWS::http2::ERR_INTERNAL_ERROR);
}

void uws_h2_res_cancel(uws_h2_res_t* res)
{
    Http2Response* r = (Http2Response*)res;
    r->clearOnWritableAndAborted();
    r->close(uWS::http2::ERR_CANCEL);
}

bool uws_h2_res_try_end(uws_h2_res_t* res, const char* bytes, size_t len, size_t total_len, bool close)
{
    return ((Http2Response*)res)->tryEnd(h2sv(bytes, len), total_len, close).first;
}

void uws_h2_res_end_without_body(uws_h2_res_t* res, bool close_connection)
{
    Http2Response* r = (Http2Response*)res;
    r->clearOnWritableAndAborted();
    r->endWithoutBody(std::nullopt, close_connection);
}

void uws_h2_res_grow_request_window(uws_h2_res_t* res) { ((uWS::Http2Response*)res)->growReceiveWindow(); }
void uws_h2_res_pause(uws_h2_res_t* res) { ((Http2Response*)res)->pause(); }
void uws_h2_res_resume(uws_h2_res_t* res) { ((Http2Response*)res)->resume(); }
void uws_h2_res_write_continue(uws_h2_res_t* res) { ((Http2Response*)res)->writeContinue(); }

void uws_h2_res_write_status(uws_h2_res_t* res, const char* status, size_t length)
{
    ((Http2Response*)res)->writeStatus(h2sv(status, length));
}

void uws_h2_res_write_header(uws_h2_res_t* res, const char* key, size_t key_len,
    const char* value, size_t value_len)
{
    ((Http2Response*)res)->writeHeader(h2sv(key, key_len), h2sv(value, value_len));
}

void uws_h2_res_write_header_int(uws_h2_res_t* res, const char* key, size_t key_len, uint64_t value)
{
    ((Http2Response*)res)->writeHeader(h2sv(key, key_len), value);
}

void uws_h2_res_mark_wrote_content_length_header(uws_h2_res_t* res)
{
    ((Http2Response*)res)->getHttpResponseData()->state |= Http2ResponseData::HTTP_WROTE_CONTENT_LENGTH_HEADER;
}

void uws_h2_res_mark_wrote_date_header(uws_h2_res_t* res)
{
    ((Http2Response*)res)->getHttpResponseData()->state |= Http2ResponseData::HTTP_WROTE_DATE_HEADER;
}

void uws_h2_res_write_mark(uws_h2_res_t* res) { ((Http2Response*)res)->writeMark(); }
void uws_h2_res_flush_headers(uws_h2_res_t* res, bool) { ((Http2Response*)res)->flushHeaders(); }

bool uws_h2_res_write(uws_h2_res_t* res, const char* data, size_t* length)
{
    size_t written = 0;
    bool ok = ((Http2Response*)res)->write(h2sv(data, *length), &written);
    *length = written;
    return ok;
}

bool uws_h2_res_has_responded(uws_h2_res_t* res) { return ((Http2Response*)res)->hasResponded(); }
size_t uws_h2_res_get_buffered_amount(uws_h2_res_t* res) { return ((Http2Response*)res)->getBufferedAmount(); }
void uws_h2_res_reset_timeout(uws_h2_res_t* res) { ((Http2Response*)res)->resetTimeout(); }
void uws_h2_res_timeout(uws_h2_res_t* res, uint8_t seconds) { ((Http2Response*)res)->setTimeout(seconds); }
void uws_h2_res_websocket_timeout(uws_h2_res_t* res, uint16_t seconds) { ((Http2Response*)res)->setWebSocketTimeout(seconds); }
void uws_h2_res_websocket_timeout_config(uws_h2_res_t* res, uint16_t seconds, bool refresh_on_write)
{
    auto* response = (Http2Response*)res;
    response->setWebSocketTimeoutRefreshOnWrite(refresh_on_write);
    response->setWebSocketTimeout(seconds);
}
void uws_h2_res_websocket_timeout_refresh_on_write(uws_h2_res_t* res, bool enabled) { ((Http2Response*)res)->setWebSocketTimeoutRefreshOnWrite(enabled); }
void uws_h2_res_end_sendfile(uws_h2_res_t* res, uint64_t, bool close)
{
    ((Http2Response*)res)->sendTerminatingChunk(close);
}

void uws_h2_res_on_writable(uws_h2_res_t* res, bool (*h)(uws_h2_res_t*, uint64_t, void*), void* opt)
{
    ((Http2Response*)res)->onWritable(opt, (Http2ResponseData::OnWritableCallback)h);
}
void uws_h2_res_clear_on_writable(uws_h2_res_t* res) { ((Http2Response*)res)->clearOnWritable(); }
void uws_h2_res_on_aborted(uws_h2_res_t* res, void (*h)(uws_h2_res_t*, void*), void* opt)
{
    if (h)
        ((Http2Response*)res)->onAborted(opt, (Http2ResponseData::OnAbortedCallback)h);
    else
        ((Http2Response*)res)->clearOnAborted();
}
void uws_h2_res_on_timeout(uws_h2_res_t* res, void (*h)(uws_h2_res_t*, void*), void* opt)
{
    if (h)
        ((Http2Response*)res)->onTimeout(opt, (Http2ResponseData::OnTimeoutCallback)h);
    else
        ((Http2Response*)res)->clearOnTimeout();
}
void uws_h2_res_on_data(uws_h2_res_t* res, void (*h)(uws_h2_res_t*, const char*, size_t, bool, void*), void* opt)
{
    ((Http2Response*)res)->onData(opt, (Http2ResponseData::OnDataCallback)h);
}

void uws_h2_res_cork(uws_h2_res_t* res, void* ctx, void (*corker)(void*))
{
    ((Http2Response*)res)->cork([ctx, corker]() { corker(ctx); });
}

typedef struct uws_res_s uws_res_t;
uint64_t uws_res_get_remote_address_info(uws_res_t* res, const char** dest, int* port, bool* is_ipv6);
uint64_t uws_h2_res_get_remote_address_info(uws_h2_res_t* res, const char** dest, int* port, bool* is_ipv6)
{
    /* The HTTP/1 shim only reads the us_socket_t behind the response. */
    return uws_res_get_remote_address_info((uws_res_t*)((Http2Response*)res)->conn->s, dest, port, is_ipv6);
}

#pragma clang attribute pop

} // extern "C"
