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
#include "AbstractWorker.h"

// #include "ContentSecurityPolicy.h"
#include "ScriptExecutionContext.h"
// #include "SecurityOrigin.h"
#include "WorkerOptions.h"
#include <wtf/IsoMallocInlines.h>

namespace WebCore {

WTF_MAKE_ISO_ALLOCATED_IMPL(AbstractWorker);

FetchOptions AbstractWorker::workerFetchOptions(const WorkerOptions& options, FetchOptions::Destination destination)
{
    FetchOptions fetchOptions;
    fetchOptions.mode = FetchOptions::Mode::SameOrigin;
    if (options.type == WorkerType::Module)
        fetchOptions.credentials = options.credentials;
    else
        fetchOptions.credentials = FetchOptions::Credentials::SameOrigin;
    fetchOptions.cache = FetchOptions::Cache::Default;
    fetchOptions.redirect = FetchOptions::Redirect::Follow;
    fetchOptions.destination = destination;
    return fetchOptions;
}

ExceptionOr<URL> AbstractWorker::resolveURL(const String& url)
{
    auto& context = *scriptExecutionContext();

    // FIXME: This should use the dynamic global scope (bug #27887).
    URL scriptURL = context.completeURL(url);
    if (!scriptURL.isValid())
        return Exception { SyntaxError };

    // if (!context.securityOrigin()->canRequest(scriptURL) && !scriptURL.protocolIsData())
    //     return Exception { SecurityError };

    // ASSERT(context.contentSecurityPolicy());
    // if (!context.contentSecurityPolicy()->allowWorkerFromSource(scriptURL))
    //     return Exception { SecurityError };

    return scriptURL;
}

} // namespace WebCore
