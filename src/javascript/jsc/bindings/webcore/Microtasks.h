/*
 * Copyright (C) 2014 Yoav Weiss (yoav@yoav.ws)
 * Copyright (C) 2015 Akamai Technologies Inc. All rights reserved.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Library General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Library General Public License for more details.
 *
 * You should have received a copy of the GNU Library General Public License
 * along with this library; see the file COPYING.LIB.  If not, write to
 * the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
 * Boston, MA 02110-1301, USA.
 *
 */

#pragma once

#include <wtf/Forward.h>
#include <wtf/Vector.h>

namespace JSC {
class VM;
} // namespace JSC

namespace WebCore {

class EventLoopTask;

class MicrotaskQueue final {
    WTF_MAKE_FAST_ALLOCATED;
public:
    WEBCORE_EXPORT MicrotaskQueue(JSC::VM&);
    WEBCORE_EXPORT ~MicrotaskQueue();

    WEBCORE_EXPORT void append(std::unique_ptr<EventLoopTask>&&);
    WEBCORE_EXPORT void performMicrotaskCheckpoint();

    WEBCORE_EXPORT void addCheckpointTask(std::unique_ptr<EventLoopTask>&&);

private:
    JSC::VM& vm() const { return m_vm.get(); }

    bool m_performingMicrotaskCheckpoint { false };
    Vector<std::unique_ptr<EventLoopTask>> m_microtaskQueue;
    // For the main thread the VM lives forever. For workers it's lifetime is tied to our owning WorkerGlobalScope. Regardless, we retain the VM here to be safe.
    Ref<JSC::VM> m_vm;

    Vector<std::unique_ptr<EventLoopTask>> m_checkpointTasks;
};

} // namespace WebCore
