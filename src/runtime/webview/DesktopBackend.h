#pragma once

#include "root.h"

#if OS(DARWIN)

namespace Zig {
class GlobalObject;
}

namespace Bun {
namespace WebViewProto {
struct Frame;
struct Reader;
}

namespace DesktopBackend {

bool hasActiveWindows();
bool handleReply(Zig::GlobalObject* global, const WebViewProto::Frame& h, WebViewProto::Reader r);
void onHostDied();

} // namespace DesktopBackend
} // namespace Bun

#endif // OS(DARWIN)
