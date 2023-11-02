/*
 *  Copyright (C) 1999-2001 Harri Porten (porten@kde.org)
 *  Copyright (C) 2004-2011, 2013, 2016 Apple Inc. All rights reserved.
 *  Copyright (C) 2007 Samuel Weinig <sam@webkit.org>
 *  Copyright (C) 2013 Michael Pruett <michael@68k.org>
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

#include "root.h"

#include "JSDOMWrapperCache.h"

namespace WebCore {
using namespace JSC;

Structure* getCachedDOMStructure(const JSDOMGlobalObject& globalObject, const ClassInfo* classInfo)
{
    return globalObject.structures().get(classInfo).get();
}

Structure* cacheDOMStructure(JSDOMGlobalObject& globalObject, Structure* structure, const ClassInfo* classInfo)
{
    auto addToStructures = [](JSDOMStructureMap& structures, JSDOMGlobalObject& globalObject, Structure* structure, const ClassInfo* classInfo) {
        ASSERT(!structures.contains(classInfo));
        return structures.set(classInfo, JSC::WriteBarrier<Structure>(globalObject.vm(), &globalObject, structure)).iterator->value.get();
    };
    if (globalObject.vm().heap.mutatorShouldBeFenced()) {
        Locker locker { globalObject.gcLock() };
        return addToStructures(globalObject.structures(), globalObject, structure, classInfo);
    }
    return addToStructures(globalObject.structures(NoLockingNecessary), globalObject, structure, classInfo);
}

} // namespace WebCore
