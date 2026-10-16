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

#include "config.h"
#include "FileReader.h"

#include "ContextDestructionObserverInlines.h"
#include "DOMException.h"
#include "EventNames.h"
#include "Exception.h"
#include "ExceptionCode.h"
#include "ExceptionOr.h"
#include "blob.h"
#include "ProgressEvent.h"
#include "ScriptExecutionContext.h"
#include <JavaScriptCore/ArrayBuffer.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/CString.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(FileReader);

// Fire the progress event at least every 50ms.
static const auto progressNotificationInterval = 50_ms;

Ref<FileReader> FileReader::create(ScriptExecutionContext& context)
{
    auto fileReader = adoptRef(*new FileReader(context));
    fileReader->suspendIfNeeded();
    return fileReader;
}

FileReader::FileReader(ScriptExecutionContext& context)
    : ActiveDOMObject(&context)
{
}

FileReader::~FileReader()
{
    if (RefPtr loader = m_loader)
        loader->cancel();
}

void FileReader::stop()
{
    m_pendingTasks.clear();
    if (RefPtr loader = m_loader) {
        loader->cancel();
        m_loader = nullptr;
    }
    m_state = DONE;
}

bool FileReader::virtualHasPendingActivity() const
{
    return m_state == LOADING;
}

ScriptExecutionContext* FileReader::scriptExecutionContext() const
{
    return ActiveDOMObject::scriptExecutionContext();
}

ExceptionOr<void> FileReader::readAsArrayBuffer(Blob& blob)
{
    return readInternal(blob, FileReaderLoader::ReadAsArrayBuffer);
}

ExceptionOr<void> FileReader::readAsBinaryString(Blob& blob)
{
    return readInternal(blob, FileReaderLoader::ReadAsBinaryString);
}

ExceptionOr<void> FileReader::readAsText(Blob& blob, const String& encoding)
{
    m_encoding = encoding;
    return readInternal(blob, FileReaderLoader::ReadAsText);
}

ExceptionOr<void> FileReader::readAsDataURL(Blob& blob)
{
    return readInternal(blob, FileReaderLoader::ReadAsDataURL);
}

ExceptionOr<void> FileReader::readInternal(Blob& blob, FileReaderLoader::ReadType type)
{
    // If multiple concurrent read methods are called on the same FileReader, InvalidStateError should be thrown when the state is LOADING.
    if (m_state == LOADING)
        return Exception { ExceptionCode::InvalidStateError };

    m_blob = blob;
    m_readType = type;
    m_state = LOADING;
    m_finishedLoading = false;
    m_error = nullptr;

    Ref loader = FileReaderLoader::create(m_readType, static_cast<FileReaderLoaderClient*>(this));
    m_loader = loader.copyRef();
    loader->setEncoding(m_encoding);
    loader->start(protect(scriptExecutionContext()).get(), blob);

    return { };
}

void FileReader::abort()
{
    if (m_state != LOADING || m_finishedLoading)
        return;

    m_pendingTasks.clear();
    stop();
    m_error = DOMException::create(ExceptionCode::AbortError);

    Ref protectedThis { *this };
    fireEvent(eventNames().abortEvent);
    fireEvent(eventNames().loadendEvent);
}

void FileReader::didStartLoading()
{
    enqueueTask([](auto& reader) {
        reader.fireEvent(eventNames().loadstartEvent);
    });
}

void FileReader::didReceiveData()
{
    enqueueTask([](auto& reader) {
        auto now = MonotonicTime::now();
        if (reader.m_lastProgressNotificationTime.isNaN()) {
            reader.m_lastProgressNotificationTime = now;
            return;
        }
        if (now - reader.m_lastProgressNotificationTime > progressNotificationInterval) {
            reader.fireEvent(eventNames().progressEvent);
            reader.m_lastProgressNotificationTime = now;
        }
    });
}

void FileReader::didFinishLoading()
{
    enqueueTask([](auto& reader) {
        if (reader.m_state == DONE)
            return;
        reader.m_finishedLoading = true;
        if (reader.m_loader->bytesLoaded())
            reader.fireEvent(eventNames().progressEvent);
        if (reader.m_state == DONE)
            return;
        reader.m_state = DONE;
        reader.fireEvent(eventNames().loadEvent);
        reader.fireEvent(eventNames().loadendEvent);
    });
}

void FileReader::didFail(ExceptionCode errorCode)
{
    enqueueTask([errorCode](auto& reader) {
        if (reader.m_state == DONE)
            return;
        reader.m_state = DONE;

        reader.m_error = DOMException::create(errorCode);

        reader.fireEvent(eventNames().errorEvent);
        reader.fireEvent(eventNames().loadendEvent);
    });
}

void FileReader::fireEvent(const AtomString& type)
{
    dispatchEvent(ProgressEvent::create(type, true, m_loader ? m_loader->bytesLoaded() : 0, m_loader ? m_loader->totalBytes() : 0));
}

std::optional<Variant<String, Ref<JSC::ArrayBuffer>>> FileReader::result() const
{
    RefPtr loader = m_loader;
    if (!loader || m_error || m_state != DONE)
        return std::nullopt;
    if (m_readType == FileReaderLoader::ReadAsArrayBuffer) {
        auto result = loader->arrayBufferResult();
        if (!result)
            return std::nullopt;
        return { result.releaseNonNull() };
    }
    String result = loader->stringResult();
    if (result.isNull())
        return std::nullopt;
    return { WTF::move(result) };
}

void FileReader::enqueueTask(Function<void(FileReader&)>&& task)
{
    if (!scriptExecutionContext())
        return;

    uint64_t taskIdentifier = ++m_taskIdentifierSeed;
    m_pendingTasks.add(taskIdentifier, WTF::move(task));
    queueTaskKeepingObjectAlive(*this, TaskSource::FileReading, [taskIdentifier](auto& reader) {
        auto task = reader.m_pendingTasks.take(taskIdentifier);
        if (task && !reader.isContextStopped())
            task(reader);
    });
}

} // namespace WebCore
