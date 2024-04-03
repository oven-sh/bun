extern "C" {
#include "quic.h"
}

#include "Http3ResponseData.h"
// clang-format off
namespace uWS {

    /* Is a quic stream */
    struct Http3Response {

        // this one is AsyncSocket, so it has to translate to the stream - abrupt stream termination
        void close() {
            //us_quic_stream_close((us_quic_stream_t *) this);
        }

        void endWithoutBody(std::optional<size_t> reportedContentLength = std::nullopt, bool closeConnection = false) {

        }

        Http3Response *writeStatus(std::string_view status) {
            Http3ResponseData *responseData = (Http3ResponseData *) us_quic_stream_ext((us_quic_stream_t *) this);

            /* Nothing is done if status already written */
            if (responseData->headerOffset == 0) {
                us_quic_socket_context_set_header(nullptr, 0, (char *) ":status", 7, status.data(), status.length());
                responseData->headerOffset = 1;
            }

            return this;
        }

        Http3Response *writeHeader(std::string_view key, std::string_view value) {
            Http3ResponseData *responseData = (Http3ResponseData *) us_quic_stream_ext((us_quic_stream_t *) this);

            writeStatus("200 OK");

            us_quic_socket_context_set_header(nullptr, responseData->headerOffset++, key.data(), key.length(), value.data(), value.length());

            return this;
        }

        std::pair<bool, bool> tryEnd(std::string_view data, uint64_t totalSize = 0) {
            Http3ResponseData *responseData = (Http3ResponseData *) us_quic_stream_ext((us_quic_stream_t *) this);

            writeStatus("200 OK");

            us_quic_socket_context_send_headers(nullptr, (us_quic_stream_t *) this, responseData->headerOffset, data.length() > 0);


            unsigned int written = us_quic_stream_write((us_quic_stream_t *) this, (char *) data.data(), (int) data.length());

            if (written == data.length()) {
                return {true, true};
            } else {

                responseData->offset = written;

                return {true, false};
            }


            return {true, true};
        }

        /* Idnetical */
        Http3Response *write(std::string_view data) {


            return this;
        }

        /* Identical */
        void end(std::string_view data = {}, bool closeConnection = false) {

            Http3ResponseData *responseData = (Http3ResponseData *) us_quic_stream_ext((us_quic_stream_t *) this);

            /* If not already written */
            writeStatus("200 OK");
            
            // has body is determined by the ending so this is perfect here
            us_quic_socket_context_send_headers(nullptr, (us_quic_stream_t *) this, responseData->headerOffset, data.length() > 0);

            /* Write body and shutdown (unknown if content-length must be present?) */
            unsigned int written = us_quic_stream_write((us_quic_stream_t *) this, (char *) data.data(), (int) data.length());

            /* Buffer up remains */
            if (written != data.length()) {
                responseData->backpressure.append(data.data() + written, data.length() - written);
            } else {
                /* Every request has its own stream, so we conceptually serve requests like in HTTP 1.0 */
                us_quic_stream_shutdown((us_quic_stream_t *) this);
            }
        }

        /* Attach handler for aborted HTTP request */
        Http3Response *onAborted(MoveOnlyFunction<void()> &&handler) {
            Http3ResponseData *responseData = (Http3ResponseData *) us_quic_stream_ext((us_quic_stream_t *) this);

            responseData->onAborted = std::move(handler);
            return this;
        }

        /* Attach a read handler for data sent. Will be called with FIN set true if last segment. */
        Http3Response *onData(MoveOnlyFunction<void(std::string_view, bool)> &&handler) {
            Http3ResponseData *responseData = (Http3ResponseData *) us_quic_stream_ext((us_quic_stream_t *) this);

            responseData->onData = std::move(handler);
            return this;
        }

        Http3Response *onWritable(MoveOnlyFunction<bool(uint64_t)> &&handler) {
            Http3ResponseData *responseData = (Http3ResponseData *) us_quic_stream_ext((us_quic_stream_t *) this);

            responseData->onWritable = std::move(handler);
            return this;
        }
    };

}