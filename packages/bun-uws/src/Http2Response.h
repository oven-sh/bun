#ifndef UWS_H2RESPONSE_H
#define UWS_H2RESPONSE_H
// clang-format off

#include "Http2ResponseData.h"
#include "AsyncSocket.h"
#include "LoopData.h"

#include <charconv>
#include <optional>
#include <string_view>

namespace uWS {

struct Http2Context;
struct Http2Connection;

/* API mirror of Http3Response / HttpResponse<SSL>. Heap-allocated per
 * stream (the socket ext holds the connection, not the stream), so unlike
 * the H1/H3 variants `this` is an actual object rather than an overlay on
 * a uSockets handle. */
struct Http2Response {
    us_socket_t *socket;
    uint32_t id;
    int32_t sendWindow;
    int32_t recvWindow;
    bool paused = false;
    bool dead = false;
    Http2ResponseData data;

    Http2Response(us_socket_t *s, uint32_t stream, int32_t remoteInitWin)
        : socket(s), id(stream), sendWindow(remoteInitWin),
          recvWindow((int32_t) 1024 * 1024) {}

    Http2ResponseData *getHttpResponseData() { return &data; }
    Http2Context *context() {
        return (Http2Context *) us_socket_group_ext(us_socket_group(socket));
    }

    Http2Response *writeStatus(std::string_view status) {
        if (data.state & Http2ResponseData::HTTP_STATUS_CALLED) return this;
        data.state |= Http2ResponseData::HTTP_STATUS_CALLED;
        /* Zig hands us "200 OK"; HTTP/2 wants only the 3-digit code. */
        std::string_view code = status.size() >= 3 ? status.substr(0, 3) : std::string_view{"200"};
        data.appendHeader(":status", 7, code.data(), (unsigned) code.size());
        return this;
    }

    Http2Response *writeHeader(std::string_view key, std::string_view value) {
        writeStatus("200 OK");
        data.appendHeader(key.data(), (unsigned) key.size(),
                          value.data(), (unsigned) value.size());
        return this;
    }

    Http2Response *writeHeader(std::string_view key, uint64_t value) {
        char buf[24];
        auto r = std::to_chars(buf, buf + sizeof(buf), value);
        return writeHeader(key, std::string_view{buf, (size_t)(r.ptr - buf)});
    }

    void writeMark() {
        if (data.state & Http2ResponseData::HTTP_WROTE_DATE_HEADER) return;
        data.state |= Http2ResponseData::HTTP_WROTE_DATE_HEADER;
        LoopData *ld = (LoopData *) us_loop_ext(us_socket_group_loop(us_socket_group(socket)));
        writeHeader("date", std::string_view{ld->date, 29});
    }

    Http2Response *writeContinue();

    void flushHeaders(bool /*immediately*/ = false) {
        if (!(data.state & Http2ResponseData::HTTP_WRITE_CALLED)) {
            writeStatus("200 OK");
            sendBufferedHeaders(false);
            data.state |= Http2ResponseData::HTTP_WRITE_CALLED;
        }
    }

    bool write(std::string_view body, size_t *writtenPtr = nullptr);
    void end(std::string_view body = {}, bool closeConnection = false) {
        internalEnd(body, body.length(), false, true, closeConnection);
    }
    std::pair<bool, bool> tryEnd(std::string_view body, uint64_t totalSize = 0, bool close = false) {
        bool ok = internalEnd(body, totalSize, true, true, close);
        return {ok, ok || hasResponded()};
    }
    void endWithoutBody(std::optional<size_t> reportedContentLength = std::nullopt,
                        bool /*closeConnection*/ = false);
    bool sendTerminatingChunk(bool /*closeConnection*/ = false);

    bool hasResponded() {
        return !(data.state & Http2ResponseData::HTTP_RESPONSE_PENDING);
    }

    uint64_t getWriteOffset() { return data.offset; }
    void overrideWriteOffset(uint64_t o) { data.offset = o; }
    void setWriteOffset(uint64_t o) { data.offset = o; }
    size_t getBufferedAmount() {
        return data.backpressure.length() +
               ((AsyncSocket<true> *) socket)->getBufferedAmount();
    }

    Http2Response *pause() { paused = true; return this; }
    Http2Response *resume();

    Http2Response *cork(MoveOnlyFunction<void()> &&fn);
    void uncork() {}
    bool isCorked() { return false; }

    void close();
    void *getNativeHandle() { return this; }
    void *getSocketData() { return data.socketData; }
    bool isConnectRequest() { return false; }
    void setTimeout(uint8_t) {}
    void resetTimeout() {}
    void prepareForSendfile() {}

    Http2Response *onWritable(void *ud, Http2ResponseData::OnWritableCallback h) {
        data.writableUserData = ud; data.onWritable = h; return this;
    }
    Http2Response *clearOnWritable() {
        data.onWritable = nullptr; data.writableUserData = nullptr; return this;
    }
    Http2Response *onAborted(void *ud, Http2ResponseData::OnAbortedCallback h) {
        data.userData = ud; data.onAborted = h; return this;
    }
    Http2Response *clearOnAborted() { data.onAborted = nullptr; return this; }
    Http2Response *onTimeout(void *ud, Http2ResponseData::OnTimeoutCallback h) {
        data.onTimeout = h; if (h) data.userData = ud; return this;
    }
    Http2Response *clearOnTimeout() { data.onTimeout = nullptr; return this; }
    void onData(void *ud, Http2ResponseData::OnDataCallback h) {
        data.inStream = h; if (h) data.userData = ud;
    }
    Http2Response *clearOnWritableAndAborted() {
        /* Like H3: leave onAborted armed so the holder learns when the
         * stream object is freed post-completion. */
        data.onWritable = nullptr; return this;
    }

    bool drain();
    void maybeDestroy();
    std::string_view getRemoteAddressAsText() {
        return ((AsyncSocket<true> *) socket)->getRemoteAddressAsText();
    }
    std::string_view getRemoteAddress() {
        return ((AsyncSocket<true> *) socket)->getRemoteAddress();
    }

private:
    void sendBufferedHeaders(bool endStream);
    bool internalEnd(std::string_view body, uint64_t totalSize, bool optional,
                     bool allowContentLength, bool closeConnection);
    void markDone();
};

}

#endif
