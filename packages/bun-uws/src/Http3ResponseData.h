#ifndef UWS_H3RESPONSEDATA_H
#define UWS_H3RESPONSEDATA_H

#include "MoveOnlyFunction.h"
#include "AsyncSocketData.h"
#include <string_view>

namespace uWS {
    struct Http3ResponseData {

        MoveOnlyFunction<void()> onAborted = nullptr;
        MoveOnlyFunction<void(std::string_view, bool)> onData = nullptr;
        MoveOnlyFunction<bool(uintmax_t)> onWritable = nullptr;

        /* Status is always first header just like for h1 */
        unsigned int headerOffset = 0;
        
        /* Write offset */
        uintmax_t offset = 0;

        BackPressure backpressure;
    };
}

#endif