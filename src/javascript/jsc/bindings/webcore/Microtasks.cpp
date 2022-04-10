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

#include "config.h"
#include "Microtasks.h"

// #include "CommonVM.h"
#include "EventLoop.h"
#include "WorkerGlobalScope.h"
#include <wtf/MainThread.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/SetForScope.h>

namespace WebCore {

MicrotaskQueue::MicrotaskQueue(JSC::VM& vm)
    : m_vm(vm)
{
}

MicrotaskQueue::~MicrotaskQueue() = default;

void MicrotaskQueue::append(std::unique_ptr<EventLoopTask>&& task)
{
    m_microtaskQueue.append(WTFMove(task));
}

void MicrotaskQueue::performMicrotaskCheckpoint()
{
    if (m_performingMicrotaskCheckpoint)
        return;

    SetForScope change(m_performingMicrotaskCheckpoint, true);
    JSC::JSLockHolder locker(vm());

    Vector<std::unique_ptr<EventLoopTask>> toKeep;
    while (!m_microtaskQueue.isEmpty()) {
        Vector<std::unique_ptr<EventLoopTask>> queue = WTFMove(m_microtaskQueue);
        for (auto& task : queue) {
            auto* group = task->group();
            if (!group || group->isStoppedPermanently())
                continue;
            if (group->isSuspended())
                toKeep.append(WTFMove(task));
            else
                task->execute();
        }
    }

    vm().finalizeSynchronousJSExecution();
    m_microtaskQueue = WTFMove(toKeep);

    auto checkpointTasks = std::exchange(m_checkpointTasks, {});
    for (auto& checkpointTask : checkpointTasks) {
        auto* group = checkpointTask->group();
        if (!group || group->isStoppedPermanently())
            continue;

        if (group->isSuspended()) {
            m_checkpointTasks.append(WTFMove(checkpointTask));
            continue;
        }

        checkpointTask->execute();
    }
}

void MicrotaskQueue::addCheckpointTask(std::unique_ptr<EventLoopTask>&& task)
{
    m_checkpointTasks.append(WTFMove(task));
}

} // namespace WebCore
