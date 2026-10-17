/*
 *  Copyright (C) 2003, 2006 Apple Inc. All rights reserved.
 *  Copyright (C) 2006 Samuel Weinig (sam@webkit.org)
 *
 *  This library is free software; you can redistribute it and/or
 *  modify it under the terms of the GNU Lesser General Public
 *  License as published by the Free Software Foundation; either
 *  version 2 of the License, or (at your option) any later version.
 *
 *  This library is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 *  Lesser General Public License for more details.
 *
 *  You should have received a copy of the GNU Lesser General Public
 *  License along with this library; if not, write to the Free Software
 *  Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA
 */

#pragma once

#include "ScriptWrappable.h"
#include <wtf/Forward.h>
#include <wtf/Ref.h>
#include <wtf/RefCounted.h>

namespace WebCore {

class Node;

// FIXME: This object has no state, so it seems a waste to allocate and reference count it.
class XMLSerializer : public ScriptWrappable, public RefCounted<XMLSerializer> {
    WTF_MAKE_TZONE_ALLOCATED(XMLSerializer);
public:
    static Ref<XMLSerializer> create() { return adoptRef(*new XMLSerializer); }

    static String serializeToString(Node&);

private:
    XMLSerializer() = default;
};

} // namespace WebCore
