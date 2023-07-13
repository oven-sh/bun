#include "root.h"

namespace WebCore {

enum SinkID : uint8_t {
    ArrayBufferSink = 0,
    TextSink = 1,
    FileSink = 2,
    HTMLRewriterSink = 3,
    HTTPResponseSink = 4,
    HTTPSResponseSink = 5,
    BrotliDecompressorSink = 6,
    BrotliCompressorSink = 7,

};
static constexpr unsigned numberOfSinkIDs
    = 8;

}