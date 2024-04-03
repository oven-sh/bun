#ifndef UWS_H3RESPONSEDATA_H
#define UWS_H3RESPONSEDATA_H

#include "AsyncSocketData.h"
#include "MoveOnlyFunction.h"
#include <string_view>
// clang-format off
namespace uWS {
    struct Http3ResponseData {

        MoveOnlyFunction<void()> onAborted = nullptr;
        MoveOnlyFunction<void(std::string_view, bool)> onData = nullptr;
        MoveOnlyFunction<bool(uint64_t)> onWritable = nullptr;

        /* Status is always first header just like for h1 */
        unsigned int headerOffset = 0;
        
        /* Write offset */
        uint64_t offset = 0;

        BackPressure backpressure;
    };
}

#endif