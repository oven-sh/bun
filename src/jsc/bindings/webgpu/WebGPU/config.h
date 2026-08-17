#pragma once

// Replaces Source/WebGPU/WebGPU/config.h from WebKit; see ../config.h.
#include "../config.h"

#include "ExportMacros.h"
#include "WebGPU.h"
#include "WebGPUExt.h"
#include "WebGPUInternal.h"
#include <Metal/Metal.h>
#include <wtf/Assertions.h>
#include <wtf/RetainPtr.h>

#include "StringCocoa.h"

// In the Cocoa builds of WTF, WTFLogAlways() formats with CoreFoundation and so
// accepts the %@ conversions these sources use. The JSCOnly build bun links
// formats with printf, so the message is expanded by Foundation first.
#define WTFLogAlways(format, ...) WTFLogAlways("%s", [NSString stringWithFormat:@format __VA_OPT__(,) __VA_ARGS__].UTF8String)
