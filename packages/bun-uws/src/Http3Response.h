#ifndef UWS_H3RESPONSE_H
#define UWS_H3RESPONSE_H

#include "quic.h"
#include "Http3ResponseData.h"
#include "HttpResponseData.h"
#include "Utilities.h"

#include <charconv>
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

    void endWithoutBody(std::optional<size_t> reportedContentLength = std::nullopt, bool /*closeConnection*/ = false) {
        Http3ResponseData *d = getHttpResponseData();
        if (reportedContentLength.has_value() &&
            !(d->state & Http3ResponseData::HTTP_WROTE_CONTENT_LENGTH_HEADER)) {
            writeHeader("content-length", (uint64_t) *reportedContentLength);
        }
        if (d->state & Http3ResponseData::HTTP_WRITE_CALLED) {
            us_quic_stream_shutdown((us_quic_stream_t *) this);
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
    size_t getBufferedAmount() { return getHttpResponseData()->backpressure.length(); }

    Http3Response *pause() {
        getHttpResponseData()->window |= Http3ResponseData::WINDOW_PAUSED;
        us_quic_stream_hold_window((us_quic_stream_t *) this, 1);
        return this;
    }
    Http3Response *resume() {
        Http3ResponseData *d = getHttpResponseData();
        /* The response sink resumes at its end with no pause() before it.
         * That must not open a first window nobody asked to open. */
        if (!(d->window & Http3ResponseData::WINDOW_PAUSED)) return this;
        d->window &= ~Http3ResponseData::WINDOW_PAUSED;
        if (!(d->window & Http3ResponseData::WINDOW_NARROW)) openReceiveWindow();
        return this;
    }
    /* The handler started consuming the body: widen this stream's window. */
    void growReceiveWindow() {
        Http3ResponseData *d = getHttpResponseData();
        if (!(d->window & Http3ResponseData::WINDOW_NARROW)) return;
        d->window &= ~Http3ResponseData::WINDOW_NARROW;
        if (!(d->window & Http3ResponseData::WINDOW_PAUSED)) openReceiveWindow();
    }

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
        d->appendHeader(name.data(), (unsigned) name.size(), value.data(), (unsigned) value.size());
    }

    /* False when the peer can send no more on the stream. */
    bool openReceiveWindow() {
        return us_quic_stream_grow_window((us_quic_stream_t *) this, Http3ResponseData::STREAM_WINDOW_SIZE) != 0;
    }

    /* Can a body still come on a request stream that its peer has not
     * ended? The content-length says so. Without one, a GET, HEAD or TRACE
     * has none (as http::Method::has_request_body) and any other method can
     * have one of unknown length. Request field names are lowercase: quic.c
     * refuses the others (us_quic_field_is_malformed). */
    bool requestMayHaveBody() {
        us_quic_stream_t *s = (us_quic_stream_t *) this;
        bool bodiless = false;
        for (unsigned int i = 0, n = us_quic_stream_header_count(s); i < n; i++) {
            const us_quic_header_t *h = us_quic_stream_header(s, i);
            std::string_view name{h->name, h->name_len}, value{h->value, h->value_len};
            if (name == "content-length") return value != "0";
            if (name == ":method") bodiless = value == "GET" || value == "HEAD" || value == "TRACE";
        }
        return !bodiless;
    }

    void sendBufferedHeaders(Http3ResponseData *d, bool endStream) {
        const char *base = d->hdrBuf.span().data();
        for (auto &h : d->hdrs) {
            h.name = base + (uintptr_t) h.name;
            h.value = base + (uintptr_t) h.value;
        }
        us_quic_stream_send_headers((us_quic_stream_t *) this,
            d->hdrs.mutableSpan().data(), (unsigned) d->hdrs.size(), endStream);
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
        d->inStream = nullptr;
        /* Leave onAborted armed: unlike an HTTP/1 socket, the QUIC stream
         * is freed once both sides FIN, so on_stream_close fires it for
         * completed responses too — that's how the holder learns the
         * pointer is about to die. */
        d->state |= Http3ResponseData::HTTP_END_CALLED;
        d->state &= ~Http3ResponseData::HTTP_RESPONSE_PENDING;
        /* The handler has committed a response. If the request body is still
         * coming, nobody will read the rest (RFC 9114 §4.1.1). STOP_SENDING
         * says so, but Chrome then drops the response it already has and
         * sends the request again. So open the window, let the on_stream_data
         * lambda read and drop up to DISCARD_LIMIT, and send STOP_SENDING
         * only past that. A request with no body to come gets STOP_SENDING
         * as before: a peer that leaves such a stream open would keep it,
         * and its slot, for as long as the connection lives. */
        d->window &= ~(Http3ResponseData::WINDOW_NARROW | Http3ResponseData::WINDOW_PAUSED);
        if (openReceiveWindow() && ((d->window & Http3ResponseData::WINDOW_DATA) || requestMayHaveBody())) {
            d->discard = Http3ResponseData::DISCARD_LIMIT;
        } else {
            /* lsquic only emits the frame when the client's FIN/RST hasn't
             * already arrived. */
            us_quic_stream_shutdown_read((us_quic_stream_t *) this);
        }
        /* H1's closeConnection means "Connection: close + FIN the socket".
         * H3 has no per-response equivalent (RFC 9114 §4.1); the bit is set
         * by AnyResponse callers that are correct for H1, so honoring it
         * here would CONNECTION_CLOSE every sibling stream on the conn. The
         * stream FIN above is the H3 termination — leave the conn alone. */
    }
};

}

#endif
