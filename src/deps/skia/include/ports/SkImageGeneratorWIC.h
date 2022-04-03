/*
 * Copyright 2016 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#include "include/core/SkTypes.h"

#if defined(SK_BUILD_FOR_WIN)

#include "include/core/SkData.h"
#include "include/core/SkImageGenerator.h"

#include <memory>

/*
 * Any Windows program that uses COM must initialize the COM library by calling
 * the CoInitializeEx function.  In addition, each thread that uses a COM
 * interface must make a separate call to this function.
 *
 * For every successful call to CoInitializeEx, the thread must call
 * CoUninitialize before it exits.
 *
 * SkImageGeneratorWIC requires the COM library and leaves it to the client to
 * initialize COM for their application.
 *
 * For more information on initializing COM, please see:
 * https://msdn.microsoft.com/en-us/library/windows/desktop/ff485844.aspx
 */
namespace SkImageGeneratorWIC {
SK_API std::unique_ptr<SkImageGenerator> MakeFromEncodedWIC(sk_sp<SkData>);
}

#endif // SK_BUILD_FOR_WIN
