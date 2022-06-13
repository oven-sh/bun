#include "root.h"

namespace WebCore {

enum SinkID : uint8_t {
    ArrayBufferSink = 0,
    TextSink = 1,
    FileSink = 2,
    HTMLRewriterSink = 3,

};
static constexpr unsigned numberOfSinkIDs
    = 4;

}