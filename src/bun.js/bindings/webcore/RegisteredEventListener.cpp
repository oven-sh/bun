/*
 * Copyright (C) 2001 Peter Kelly (pmk@post.com)
 * Copyright (C) 2001 Tobias Anton (anton@stud.fbi.fh-darmstadt.de)
 * Copyright (C) 2006 Samuel Weinig (sam.weinig@gmail.com)
 * Copyright (C) 2003-2021 Apple Inc. All rights reserved.
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
#include "RegisteredEventListener.h"

#include "AbortSignal.h"

namespace WebCore {

RegisteredEventListener::~RegisteredEventListener() = default;

void RegisteredEventListener::setAbortSignal(WeakPtr<AbortSignal, WeakPtrImplWithEventTargetData>&& signal, uint32_t algorithmIdentifier)
{
    m_abortSignal = WTF::move(signal);
    m_abortAlgorithmIdentifier = algorithmIdentifier;
}

void RegisteredEventListener::markAsRemoved()
{
    m_wasRemoved = true;

    // If this listener was registered with an AbortSignal, drop the
    // corresponding abort algorithm so the signal's m_algorithms vector
    // doesn't grow unboundedly when the same long-lived signal is reused
    // across many addEventListener/removeEventListener cycles. This is
    // safe when called from AbortSignal::runAbortSteps() because that path
    // swaps out m_algorithms before iterating, so removeAlgorithm() is a
    // no-op on the (now empty) vector.
    if (RefPtr signal = m_abortSignal.get()) {
        m_abortSignal = nullptr;
        signal->removeAlgorithm(m_abortAlgorithmIdentifier);
    }
}

} // namespace WebCore
