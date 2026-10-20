/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 * Copyright (C) 2000 Frederik Holljen (frederik.holljen@hig.no)
 * Copyright (C) 2001 Peter Kelly (pmk@post.com)
 * Copyright (C) 2006 Samuel Weinig (sam.weinig@gmail.com)
 * Copyright (C) 2004-2025 Apple Inc. All rights reserved.
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

#include "ExceptionOr.h"
#include "Node.h"
#include "NodeFilter.h"
#include <wtf/RefPtr.h>

namespace WebCore {

class NodeIteratorBase {
public:
    Node& root() { return m_root.get(); }
    const Node& root() const { return m_root.get(); }

    unsigned whatToShow() const { return m_whatToShow; }
    NodeFilter* filter() const { return m_filter.get(); }

protected:
    NodeIteratorBase(Node&, unsigned whatToShow, RefPtr<NodeFilter>&&);
    ExceptionOr<unsigned short> acceptNode(Node& node)
    {
        // https://dom.spec.whatwg.org/#concept-node-filter
        if (!m_filter)
            return matchesWhatToShow(node) ? NodeFilter::FILTER_ACCEPT : NodeFilter::FILTER_SKIP;
        return acceptNodeSlowCase(node);
    }

    bool matchesWhatToShow(const Node& node) const
    {
        unsigned nodeMask = 1 << (std::to_underlying(node.nodeType()) - 1);
        return nodeMask & m_whatToShow;
    }

private:
    ExceptionOr<unsigned short> acceptNodeSlowCase(Node&);

    const Ref<Node> m_root;
    const RefPtr<NodeFilter> m_filter;
    unsigned m_whatToShow;
    bool m_isActive { false };
};

} // namespace WebCore
