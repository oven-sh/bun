/*
 *  Copyright (C) 2023 Apple Inc. All rights reserved.
 *
 *  This library is free software; you can redistribute it and/or
 *  modify it under the terms of the GNU Library General Public
 *  License as published by the Free Software Foundation; either
 *  version 2 of the License, or (at your option) any later version.
 *
 *  This library is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 *  Library General Public License for more details.
 *
 *  You should have received a copy of the GNU Library General Public License
 *  along with this library; see the file COPYING.LIB.  If not, write to
 *  the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
 *  Boston, MA 02110-1301, USA.
 *
 */
#pragma once
#ifdef BUN_FUZZILLI_ENABLED

#include <wtf/FilePrintStream.h>
#include <wtf/Vector.h>

namespace Fuzzilli {

struct SharedData {
    uint32_t numEdges;
    uint8_t edges[];
};

extern struct SharedData* sharedData;

extern uint32_t* edgesStart;
extern uint32_t* edgesStop;

extern char* reprlInputData;
extern size_t numPendingRejectedPromises;

void resetCoverageEdges();

FilePrintStream& logFile();

void waitForCommand();

void initializeCoverage(uint32_t* start, uint32_t* stop);

void readInput(Vector<char>* buffer);

void flushReprl(int32_t result);

void initializeReprl();

void runReprl(JSC::JSGlobalObject* globalObject);

} // namespace Fuzzilli

#endif // BUN_FUZZILLI_ENABLED

namespace Fuzzilli {

} // namespace Fuzzilli
