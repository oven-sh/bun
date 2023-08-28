/*
 * Authored by Alex Hultman, 2018-2020.
 * Intellectual property of third-party.

 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 *     http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#ifndef UWS_LOOPDATA_H
#define UWS_LOOPDATA_H

#include <thread>
#include <functional>
#include <vector>
#include <mutex>
#include <map>
#include <ctime>
#include <cstdint>

#include "PerMessageDeflate.h"
#include "MoveOnlyFunction.h"

struct us_timer_t;

namespace uWS {

struct Loop;

struct alignas(16) LoopData {
    friend struct Loop;
private:
    std::mutex deferMutex;
    int currentDeferQueue = 0;
    std::vector<MoveOnlyFunction<void()>> deferQueues[2];

    /* Map from void ptr to handler */
    std::map<void *, MoveOnlyFunction<void(Loop *)>> postHandlers, preHandlers;

public:
    LoopData() {
        updateDate();
    }

    ~LoopData() {
        /* If we have had App.ws called with compression we need to clear this */
        if (zlibContext) {
            delete zlibContext;
            delete inflationStream;
            delete deflationStream;
        }
        delete [] corkBuffer;
    }

    void updateDate() {
        time_t now = time(0);
        struct tm tstruct = {};
#ifdef _WIN32
        /* Micro, fucking soft never follows spec. */
        gmtime_s(&tstruct, &now);
#else
        gmtime_r(&now, &tstruct);
#endif
        static const char wday_name[][4] = {
            "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"
        };
        static const char mon_name[][4] = {
            "Jan", "Feb", "Mar", "Apr", "May", "Jun",
            "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
        };
        snprintf(date, 32, "%.3s, %.2u %.3s %.4u %.2u:%.2u:%.2u GMT",
            wday_name[tstruct.tm_wday],
            tstruct.tm_mday % 99,
            mon_name[tstruct.tm_mon],
            (1900 + tstruct.tm_year) % 9999,
            tstruct.tm_hour % 99,
            tstruct.tm_min % 99,
            tstruct.tm_sec % 99);
    }

    char date[32];

    /* Be silent */
    bool noMark = false;

    /* Good 16k for SSL perf. */
    static const unsigned int CORK_BUFFER_SIZE = 16 * 1024;

    /* Cork data */
    char *corkBuffer = new char[CORK_BUFFER_SIZE];
    unsigned int corkOffset = 0;
    void *corkedSocket = nullptr;

    /* Per message deflate data */
    ZlibContext *zlibContext = nullptr;
    InflationStream *inflationStream = nullptr;
    DeflationStream *deflationStream = nullptr;

    us_timer_t *dateTimer;
};

}

#endif // UWS_LOOPDATA_H
