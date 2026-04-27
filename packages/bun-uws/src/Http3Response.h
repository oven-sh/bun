#ifndef UWS_H3RESPONSE_H
#define UWS_H3RESPONSE_H

#include "quic.h"
#include "Http3ResponseData.h"
#include "HttpResponseData.h"

#include <optional>
#include <string_view>

namespace uWS {

/* API mirror of HttpResponse<SSL>. Http3Response is a zero-member overlay on
 * us_quic_stream_t; per-stream state lives in Http3ResponseData stored in the
 * stream's ext. */
struct Http3Response {

    Http3ResponseData *getHttpResponseData() {
        return (Http3ResponseData *) us_quic_stream_ext((us_quic_stream_t *) this);
    }

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
        writeStatus("200 OK");
        appendHeader(getHttpResponseData(), key, value);
        return this;
    }

    Http3Response *writeHeader(std::string_view key, uint64_t value) {
        char buf[24];
        int n = snprintf(buf, sizeof(buf), "%llu", (unsigned long long) value);
        return writeHeader(key, std::string_view{buf, (size_t) n});
    }

    void writeMark() {
        Http3ResponseData *d = getHttpResponseData();
        if (d->state & Http3ResponseData::HTTP_WROTE_DATE_HEADER) return;
        d->state |= Http3ResponseData::HTTP_WROTE_DATE_HEADER;
        LoopData *ld = (LoopData *) us_loop_ext(
            (us_loop_t *) us_quic_socket_context_loop(us_quic_stream_context((us_quic_stream_t *) this)));
        writeHeader("date", std::string_view{ld->date, 29});
    }

    /* RFC 9114 §4.1: a 1xx response is its own HEADERS frame with no body and
     * doesn't consume the final-response slot. */
    Http3Response *writeContinue() {
        us_quic_stream_send_informational((us_quic_stream_t *) this, "100");
        return this;
    }

    void flushHeaders(bool /*immediately*/ = false) {
        Http3ResponseData *d = getHttpResponseData();
        if (!(d->state & Http3ResponseData::HTTP_WRITE_CALLED)) {
            writeStatus("200 OK");
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
            us_quic_stream_want_write((us_quic_stream_t *) this, 1);
            return false;
        }
        int w = us_quic_stream_write((us_quic_stream_t *) this, data.data(), (unsigned) data.length());
        if (w < 0) w = 0;
        d->offset += (uint64_t) w;
        if (writtenPtr) *writtenPtr = (size_t) w;
        if ((size_t) w < data.length()) {
            d->backpressure.append(data.data() + w, data.length() - (size_t) w);
            us_quic_stream_want_write((us_quic_stream_t *) this, 1);
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

    void endWithoutBody(std::optional<size_t> reportedContentLength = std::nullopt, bool closeConnection = false) {
        Http3ResponseData *d = getHttpResponseData();
        if (closeConnection) d->state |= Http3ResponseData::HTTP_CONNECTION_CLOSE;
        if (reportedContentLength.has_value() &&
            !(d->state & Http3ResponseData::HTTP_WROTE_CONTENT_LENGTH_HEADER)) {
            writeHeader("content-length", (uint64_t) *reportedContentLength);
        }
        if (d->state & Http3ResponseData::HTTP_WRITE_CALLED) {
            us_quic_stream_shutdown((us_quic_stream_t *) this);
        } else {
            writeStatus("200 OK");
            sendBufferedHeaders(d, true);
        }
        markDone(d);
    }

    bool sendTerminatingChunk(bool closeConnection = false) {
        Http3ResponseData *d = getHttpResponseData();
        if (closeConnection) d->state |= Http3ResponseData::HTTP_CONNECTION_CLOSE;
        flushHeaders();
        if (d->backpressure.length() != 0) {
            d->endAfterDrain = true;
            us_quic_stream_want_write((us_quic_stream_t *) this, 1);
            return false;
        }
        us_quic_stream_shutdown((us_quic_stream_t *) this);
        markDone(d);
        return true;
    }

    bool hasResponded() {
        return !(getHttpResponseData()->state & Http3ResponseData::HTTP_RESPONSE_PENDING);
    }

    uint64_t getWriteOffset() { return getHttpResponseData()->offset; }
    void overrideWriteOffset(uint64_t o) { getHttpResponseData()->offset = o; }
    void setWriteOffset(uint64_t o) { getHttpResponseData()->offset = o; }
    size_t getBufferedAmount() { return getHttpResponseData()->backpressure.length(); }

    Http3Response *pause() { us_quic_stream_want_read((us_quic_stream_t *) this, 0); return this; }
    Http3Response *resume() { us_quic_stream_want_read((us_quic_stream_t *) this, 1); return this; }

    Http3Response *cork(MoveOnlyFunction<void()> &&fn) { fn(); return this; }
    void uncork() {}
    bool isCorked() { return false; }

    void close() { us_quic_stream_close((us_quic_stream_t *) this); }
    void *getNativeHandle() { return this; }
    void *getSocketData() { return getHttpResponseData()->socketData; }
    bool isConnectRequest() { return false; }
    void setTimeout(uint8_t) {}
    void resetTimeout() {}
    void prepareForSendfile() {}

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
         * freed after FIN and on_stream_close needs it to notify the holder.
         * Name kept for parity with the H1 C wrapper. */
        Http3ResponseData *d = getHttpResponseData();
        d->onWritable = nullptr; return this;
    }

    /* Called from Http3Context's on_stream_writable. */
    bool drain() {
        Http3ResponseData *d = getHttpResponseData();
        while (d->backpressure.length() != 0) {
            int w = us_quic_stream_write((us_quic_stream_t *) this,
                d->backpressure.data(), (unsigned) d->backpressure.length());
            if (w <= 0) return false;
            d->offset += (uint64_t) w;
            d->backpressure.erase((unsigned) w);
        }
        if (d->endAfterDrain) {
            d->endAfterDrain = false;
            us_quic_stream_shutdown((us_quic_stream_t *) this);
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
        /* RFC 9114 §4.2: field names MUST be lowercase. Callers hand us
         * canonical-cased names (Content-Type), so fold here once where the
         * protocol invariant lives. */
        unsigned no = (unsigned) d->headerBuf.size();
        for (char c : name) d->headerBuf.push_back((c >= 'A' && c <= 'Z') ? (char)(c | 0x20) : c);
        unsigned vo = (unsigned) d->headerBuf.size();
        d->headerBuf.append(value);
        d->headerNames.push_back({no, (unsigned) name.size()});
        d->headerValues.push_back({vo, (unsigned) value.size()});
    }

    void sendBufferedHeaders(Http3ResponseData *d, bool endStream) {
        size_t n = d->headerNames.size();
        std::vector<us_quic_header_t> hs(n);
        for (size_t i = 0; i < n; i++) {
            hs[i].name = d->headerBuf.data() + d->headerNames[i].first;
            hs[i].name_len = d->headerNames[i].second;
            hs[i].value = d->headerBuf.data() + d->headerValues[i].first;
            hs[i].value_len = d->headerValues[i].second;
        }
        us_quic_stream_send_headers((us_quic_stream_t *) this, hs.data(), (unsigned) n, endStream);
        d->headerBuf.clear();
        d->headerNames.clear();
        d->headerValues.clear();
    }

    bool internalEnd(std::string_view data, uint64_t totalSize, bool optional,
                     bool /*allowContentLength*/, bool closeConnection) {
        Http3ResponseData *d = getHttpResponseData();
        if (closeConnection) d->state |= Http3ResponseData::HTTP_CONNECTION_CLOSE;
        d->totalSize = totalSize;

        if (!(d->state & Http3ResponseData::HTTP_WRITE_CALLED)) {
            writeStatus("200 OK");
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
            us_quic_stream_want_write((us_quic_stream_t *) this, 1);
            return false;
        }

        int w = data.empty() ? 0
            : us_quic_stream_write((us_quic_stream_t *) this, data.data(), (unsigned) data.length());
        if (w < 0) w = 0;
        d->offset += (uint64_t) w;
        if ((size_t) w < data.length()) {
            if (optional) {
                us_quic_stream_want_write((us_quic_stream_t *) this, 1);
                return false;
            }
            d->backpressure.append(data.data() + w, data.length() - (size_t) w);
            d->endAfterDrain = true;
            us_quic_stream_want_write((us_quic_stream_t *) this, 1);
            return false;
        }

        if (d->offset >= totalSize) {
            us_quic_stream_shutdown((us_quic_stream_t *) this);
            markDone(d);
            return true;
        }
        us_quic_stream_want_write((us_quic_stream_t *) this, 1);
        return false;
    }

    void markDone(Http3ResponseData *d) {
        d->onWritable = nullptr;
        /* Leave onAborted armed: unlike an HTTP/1 socket, the QUIC stream
         * is freed once both sides FIN, so on_stream_close fires it for
         * completed responses too — that's how the holder learns the
         * pointer is about to die. */
        d->state |= Http3ResponseData::HTTP_END_CALLED;
        d->state &= ~Http3ResponseData::HTTP_RESPONSE_PENDING;
        if (d->state & Http3ResponseData::HTTP_CONNECTION_CLOSE) {
            us_quic_socket_t *qs = us_quic_stream_socket((us_quic_stream_t *) this);
            if (qs) us_quic_socket_close(qs);
        }
    }
};

}

#endif
