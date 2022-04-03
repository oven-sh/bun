// Copyright 2018 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
#ifndef SkTraceEventPhase_DEFINED
#define SkTraceEventPhase_DEFINED

// Phase indicates the nature of an event entry. E.g. part of a begin/end pair.
#define TRACE_EVENT_PHASE_BEGIN ('B')
#define TRACE_EVENT_PHASE_END ('E')
#define TRACE_EVENT_PHASE_COMPLETE ('X')
#define TRACE_EVENT_PHASE_INSTANT ('I')
#define TRACE_EVENT_PHASE_ASYNC_BEGIN ('S')
#define TRACE_EVENT_PHASE_ASYNC_END ('F')
#define TRACE_EVENT_PHASE_COUNTER ('C')
#define TRACE_EVENT_PHASE_CREATE_OBJECT ('N')
#define TRACE_EVENT_PHASE_SNAPSHOT_OBJECT ('O')
#define TRACE_EVENT_PHASE_DELETE_OBJECT ('D')

#endif  // SkTraceEventPhase_DEFINED
