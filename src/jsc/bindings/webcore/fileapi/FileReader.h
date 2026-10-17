/*
 * Copyright (C) 2010 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "ActiveDOMObject.h"
#include "DOMException.h"
#include "EventTarget.h"
#include "EventTargetInterfaces.h"
#include "ExceptionCode.h"
#include "FileReaderLoader.h"
#include "FileReaderLoaderClient.h"
#include <wtf/HashMap.h>
#include <wtf/UniqueRef.h>

namespace JSC {
class ArrayBuffer;
}

namespace WebCore {

class Blob;
template<typename> class ExceptionOr;

class FileReader final : public RefCounted<FileReader>, public ActiveDOMObject, public EventTarget, private FileReaderLoaderClient {
    WTF_MAKE_TZONE_ALLOCATED(FileReader);
public:
    static Ref<FileReader> create(ScriptExecutionContext&);

    virtual ~FileReader();

    // ContextDestructionObserver.
    void ref() const final { RefCounted::ref(); }
    void deref() const final { RefCounted::deref(); }
    USING_CAN_MAKE_WEAKPTR(EventTarget);

    enum ReadyState {
        EMPTY = 0,
        LOADING = 1,
        DONE = 2
    };

    ExceptionOr<void> readAsArrayBuffer(Blob&);
    ExceptionOr<void> readAsBinaryString(Blob&);
    ExceptionOr<void> readAsText(Blob&, const String& encoding);
    ExceptionOr<void> readAsDataURL(Blob&);
    void abort();

    void doAbort();

    ReadyState readyState() const { return m_state; }
    DOMException* error() { return m_error.get(); }
    FileReaderLoader::ReadType readType() const { return m_readType; }
    std::optional<Variant<String, Ref<JSC::ArrayBuffer>>> result() const;

private:
    explicit FileReader(ScriptExecutionContext&);

    // ActiveDOMObject.
    void stop() final;
    bool virtualHasPendingActivity() const final;

    enum EventTargetInterfaceType eventTargetInterface() const final { return EventTargetInterfaceType::FileReader; }
    ScriptExecutionContext* scriptExecutionContext() const final;
    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }

    void enqueueTask(Function<void(FileReader&)>&&);

    void didStartLoading() final;
    void didReceiveData() final;
    void didFinishLoading() final;
    void didFail(ExceptionCode errorCode) final;

    ExceptionOr<void> readInternal(Blob&, FileReaderLoader::ReadType);
    void fireErrorEvent(int httpStatusCode);
    void fireEvent(const AtomString& type);

    ReadyState m_state { EMPTY };
    bool m_finishedLoading { false };
    RefPtr<Blob> m_blob;
    FileReaderLoader::ReadType m_readType { FileReaderLoader::ReadAsBinaryString };
    String m_encoding;
    RefPtr<FileReaderLoader> m_loader;
    RefPtr<DOMException> m_error;
    MonotonicTime m_lastProgressNotificationTime { MonotonicTime::nan() };
    HashMap<uint64_t, Function<void(FileReader&)>> m_pendingTasks;
    uint64_t m_taskIdentifierSeed { 0 };
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_EVENTTARGET(FileReader)
