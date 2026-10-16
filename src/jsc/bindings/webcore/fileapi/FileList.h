/*
 * Copyright (C) 2008-2019 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "ScriptWrappable.h"
#include "blob.h"
#include <wtf/RefCounted.h>
#include <wtf/RefPtr.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/Vector.h>

namespace WebCore {

class FileList final : public ScriptWrappable, public RefCounted<FileList> {
    WTF_MAKE_TZONE_ALLOCATED_EXPORT(FileList, WEBCORE_EXPORT);
public:
    static Ref<FileList> create()
    {
        return adoptRef(*new FileList);
    }

    static Ref<FileList> create(Vector<Ref<Blob>>&& files)
    {
        return adoptRef(*new FileList(WTF::move(files)));
    }

    WEBCORE_EXPORT ~FileList();

    unsigned length() const { return m_files.size(); }
    WEBCORE_EXPORT Blob* LEGACY_NODELETE item(unsigned index) const;
    bool isSupportedPropertyIndex(unsigned index) const { return index < m_files.size(); }

    bool isEmpty() const { return m_files.isEmpty(); }

    const Vector<Ref<Blob>>& files() const LIFETIME_BOUND { return m_files; }
    Blob& file(unsigned index) const { return m_files[index].get(); }

private:
    FileList() = default;
    FileList(Vector<Ref<Blob>>&& files)
        : m_files(WTF::move(files))
    {
    }

    // FileLists can only be changed by their owners.
    friend class FileInputType;
    void clear() { m_files.clear(); }

    Vector<Ref<Blob>> m_files;
};

} // namespace WebCore
