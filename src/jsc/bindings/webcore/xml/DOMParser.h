/*
 *  Copyright (C) 2003, 2006 Apple Inc. All rights reserved.
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
#include <wtf/RefCounted.h>
#include <wtf/WeakPtr.h>
#include <wtf/text/AtomString.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

class Document;
class ScriptExecutionContext;
class WeakPtrImplWithEventTargetData;
template<typename> class ExceptionOr;

class DOMParser : public ScriptWrappable, public RefCounted<DOMParser> {
    WTF_MAKE_TZONE_ALLOCATED(DOMParser);
public:
    static Ref<DOMParser> create(Document& contextDocument);
    static Ref<DOMParser> create(ScriptExecutionContext&);
    ~DOMParser();

    ExceptionOr<Ref<Document>> parseFromString(String&&, const AtomString& contentType);

private:
    DOMParser(ScriptExecutionContext&, Document* contextDocument);

    const Ref<ScriptExecutionContext> m_scriptExecutionContext;
    WeakPtr<Document, WeakPtrImplWithEventTargetData> m_contextDocument;
};

}
