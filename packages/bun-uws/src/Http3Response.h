#ifndef UWS_H3RESPONSE_H
#define UWS_H3RESPONSE_H

#include "quic.h"
#include "Http3ResponseData.h"
#include "HttpResponseData.h"
#include "LoopData.h"
#include "Utilities.h"

#include <charconv>
#include <optional>
#include <string_view>

namespace uWS {

struct Http3Context;

/* API mirror of HttpResponse<SSL>. */
struct Http3Response {
    us_quic_stream_t stream;
    Http3Context *context;
    LoopData *loopData;
    Http3ResponseData data;

    Http3ResponseData *getHttpResponseData() { return &data; }

    Http3Response *writeStatus(std::string_view status) {
        Http3ResponseData *d = getHttpResponseData();
        if (d->state & Http3ResponseData::HTTP_STATUS_CALLED) return this;
        d->state |= Http3ResponseData::HTTP_STATUS_CALLED;
        /* Zig hands us "200 OK"; HTTP/3 wants only the 3-digit code. */
        std::string_view code = status.size() >= 3 ? status.substr(0, 3) : std::string_view{"200"};
        appendHeader(d, ":status", code);
        return this;
    }

    Http3Response *writeHeader(std::string_view key, std::string_view value) {
        if (isConnectionSpecificResponseField(key, value)) return this;
        writeStatus("200 OK");
        appendHeader(getHttpResponseData(), key, value);
        return this;
    }

    Http3Response *writeHeader(std::string_view key, uint64_t value) {
        char buf[utils::U64_MAX_DIGITS];
        auto r = std::to_chars(buf, buf + sizeof(buf), value);
        return writeHeader(key, std::string_view{buf, (size_t)(r.ptr - buf)});
    }

    void writeMark() {
        Http3ResponseData *d = getHttpResponseData();
        if (d->state & Http3ResponseData::HTTP_WROTE_DATE_HEADER) return;
        d->state |= Http3ResponseData::HTTP_WROTE_DATE_HEADER;
        writeHeader("date", std::string_view{loopData->date, 29});
    }

    /* RFC 9114 §4.1: a 1xx response is its own HEADERS frame with no body and
     * doesn't consume the final-response slot. */
    Http3Response *writeContinue() {
        us_quic_header_t status{":status", 7, "100", 3, -1};
        us_quic_stream_send_headers(&stream, &status, 1, false);
        return this;
    }

    void flushHeaders(bool /*immediately*/ = false) {
        Http3ResponseData *d = getHttpResponseData();
        if (!(d->state & Http3ResponseData::HTTP_WRITE_CALLED)) {
            writeStatus("200 OK");
            writeMark();
            sendBufferedHeaders(d, false);
            d->state |= Http3ResponseData::HTTP_WRITE_CALLED;
        }
    }

    bool write(std::string_view data, size_t *writtenPtr = nullptr) {
        Http3ResponseData *d = getHttpResponseData();
        flushHeaders();
        if (d->backpressure.length() != 0) {
            d->backpressure.append(data.data(), data.length());
            if (writtenPtr) *writtenPtr = 0;
            us_quic_stream_want_write(&stream);
            return false;
        }
        size_t w = us_quic_stream_write(&stream, data.data(), data.length());
        d->offset += w;
        if (writtenPtr) *writtenPtr = w;
        if (w < data.length()) {
            d->backpressure.append(data.data() + w, data.length() - w);
            return false;
        }
        return true;
    }

    void end(std::string_view data = {}, bool closeConnection = false) {
        internalEnd(data, data.length(), false, true, closeConnection);
    }

    std::pair<bool, bool> tryEnd(std::string_view data, uint64_t totalSize = 0, bool closeConnection = false) {
        bool ok = internalEnd(data, totalSize, true, true, closeConnection);
        return {ok, ok || hasResponded()};
    }

    void endWithoutBody(std::optional<size_t> reportedContentLength = std::nullopt, bool /*closeConnection*/ = false) {
        Http3ResponseData *d = getHttpResponseData();
        if (reportedContentLength.has_value() &&
            !(d->state & Http3ResponseData::HTTP_WROTE_CONTENT_LENGTH_HEADER)) {
            writeHeader("content-length", (uint64_t) *reportedContentLength);
        }
        if (d->state & Http3ResponseData::HTTP_WRITE_CALLED) {
            us_quic_stream_shutdown(&stream);
        } else {
            writeStatus("200 OK");
            writeMark();
            sendBufferedHeaders(d, true);
        }
        markDone(d);
    }

    bool sendTerminatingChunk(bool /*closeConnection*/ = false) {
        Http3ResponseData *d = getHttpResponseData();
        flushHeaders();
        if (d->backpressure.length() != 0) {
            d->endAfterDrain = true;
            us_quic_stream_want_write(&stream);
            return false;
        }
        us_quic_stream_shutdown(&stream);
        markDone(d);
        return true;
    }

    bool hasResponded() {
        return !(getHttpResponseData()->state & Http3ResponseData::HTTP_RESPONSE_PENDING);
    }

    uint64_t getWriteOffset() { return getHttpResponseData()->offset; }
    void overrideWriteOffset(uint64_t o) { getHttpResponseData()->offset = o; }
    size_t getBufferedAmount() { return getHttpResponseData()->backpressure.length(); }

    Http3Response *pause() { us_quic_stream_want_read(&stream, false); return this; }
    Http3Response *resume() { us_quic_stream_want_read(&stream, true); return this; }

    Http3Response *cork(MoveOnlyFunction<void()> &&fn) { fn(); return this; }
    void *getSocketData() { return getHttpResponseData()->socketData; }

    Http3Response *onWritable(void *userData, Http3ResponseData::OnWritableCallback h) {
        Http3ResponseData *d = getHttpResponseData();
        d->writableUserData = userData; d->onWritable = h; return this;
    }
    Http3Response *clearOnWritable() {
        Http3ResponseData *d = getHttpResponseData();
        d->onWritable = nullptr; d->writableUserData = nullptr; return this;
    }
    Http3Response *onAborted(void *userData, Http3ResponseData::OnAbortedCallback h) {
        Http3ResponseData *d = getHttpResponseData();
        d->userData = userData; d->onAborted = h; return this;
    }
    Http3Response *clearOnAborted() { getHttpResponseData()->onAborted = nullptr; return this; }
    Http3Response *onTimeout(void *userData, Http3ResponseData::OnTimeoutCallback h) {
        Http3ResponseData *d = getHttpResponseData();
        d->onTimeout = h;
        if (h) d->userData = userData;
        return this;
    }
    Http3Response *clearOnTimeout() { getHttpResponseData()->onTimeout = nullptr; return this; }
    void onData(void *userData, Http3ResponseData::OnDataCallback h) {
        Http3ResponseData *d = getHttpResponseData();
        d->inStream = h;
        if (h) d->userData = userData;
    }
    Http3Response *clearOnWritableAndAborted() {
        /* Unlike HttpResponse<SSL>, leave onAborted armed — the QUIC stream is
         * freed after FIN and on_close needs it to notify the holder.
         * Name kept for parity with the H1 C wrapper. */
        Http3ResponseData *d = getHttpResponseData();
        d->onWritable = nullptr; return this;
    }

    /* Called from Http3Context's on_writable. */
    bool drain() {
        Http3ResponseData *d = getHttpResponseData();
        while (d->backpressure.length() != 0) {
            size_t w = us_quic_stream_write(&stream, d->backpressure.data(), d->backpressure.length());
            if (w == 0) return false;
            d->offset += w;
            d->backpressure.erase(w);
        }
        if (d->endAfterDrain) {
            d->endAfterDrain = false;
            us_quic_stream_shutdown(&stream);
            markDone(d);
            return true;
        }
        if (d->onWritable) {
            return d->onWritable(this, d->offset, d->writableUserData);
        }
        return true;
    }

private:
    void appendHeader(Http3ResponseData *d, std::string_view name, std::string_view value) {
        d->appendHeader(name.data(), (unsigned) name.size(), value.data(), (unsigned) value.size());
    }

    void sendBufferedHeaders(Http3ResponseData *d, bool endStream) {
        const char *base = d->hdrBuf.span().data();
        for (auto &h : d->hdrs) {
            h.name = base + (uintptr_t) h.name;
            h.value = base + (uintptr_t) h.value;
        }
        us_quic_stream_send_headers(&stream, d->hdrs.span().data(), (unsigned) d->hdrs.size(), endStream);
        d->hdrBuf.shrink(0);
        d->hdrs.shrink(0);
    }

    bool internalEnd(std::string_view data, uint64_t totalSize, bool optional,
                     bool /*allowContentLength*/, bool /*closeConnection*/) {
        Http3ResponseData *d = getHttpResponseData();

        if (!(d->state & Http3ResponseData::HTTP_WRITE_CALLED)) {
            writeStatus("200 OK");
            writeMark();
            if (!(d->state & Http3ResponseData::HTTP_WROTE_CONTENT_LENGTH_HEADER) && totalSize) {
                writeHeader("content-length", totalSize);
                d->state |= Http3ResponseData::HTTP_WROTE_CONTENT_LENGTH_HEADER;
            }
            if (data.empty() && d->offset == totalSize) {
                sendBufferedHeaders(d, true);
                markDone(d);
                return true;
            }
            sendBufferedHeaders(d, false);
            d->state |= Http3ResponseData::HTTP_WRITE_CALLED;
        }

        if (d->backpressure.length() != 0) {
            if (optional) return false;
            d->backpressure.append(data.data(), data.length());
            d->endAfterDrain = true;
            us_quic_stream_want_write(&stream);
            return false;
        }

        size_t w = data.empty() ? 0 : us_quic_stream_write(&stream, data.data(), data.length());
        d->offset += w;
        if (w < data.length()) {
            if (optional) return false;
            d->backpressure.append(data.data() + w, data.length() - w);
            d->endAfterDrain = true;
            return false;
        }

        if (d->offset >= totalSize) {
            us_quic_stream_shutdown(&stream);
            markDone(d);
            return true;
        }
        us_quic_stream_want_write(&stream);
        return false;
    }

    void markDone(Http3ResponseData *d) {
        d->onWritable = nullptr;
        d->inStream = nullptr;
        /* Leave onAborted armed: unlike an HTTP/1 socket, the QUIC stream
         * is freed once both sides FIN, so on_close fires it for
         * completed responses too — that's how the holder learns the
         * pointer is about to die. */
        d->state |= Http3ResponseData::HTTP_END_CALLED;
        d->state &= ~Http3ResponseData::HTTP_RESPONSE_PENDING;
        /* The handler has committed a response; if it returned without
         * consuming the request body, STOP_SENDING tells the client to
         * abort its upload instead of pushing bytes the app will never
         * read (RFC 9114 §4.1.1). */
        us_quic_stream_shutdown_read(&stream);
        /* H1's closeConnection means "Connection: close + FIN the socket".
         * H3 has no per-response equivalent (RFC 9114 §4.1); the bit is set
         * by AnyResponse callers that are correct for H1, so honoring it
         * here would CONNECTION_CLOSE every sibling stream on the conn. The
         * stream FIN above is the H3 termination — leave the conn alone. */
    }
};

}

#endif
