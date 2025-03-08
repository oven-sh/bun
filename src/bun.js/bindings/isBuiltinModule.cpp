#include "root.h"

static constexpr ASCIILiteral builtinModuleNamesSortedLength[] = {
    "fs"_s,
    "os"_s,
    "v8"_s,
    "vm"_s,
    "ws"_s,
    "bun"_s,
    "dns"_s,
    "net"_s,
    "sys"_s,
    "tls"_s,
    "tty"_s,
    "url"_s,
    "http"_s,
    "path"_s,
    "repl"_s,
    "util"_s,
    "wasi"_s,
    "zlib"_s,
    "dgram"_s,
    "http2"_s,
    "https"_s,
    "assert"_s,
    "buffer"_s,
    "crypto"_s,
    "domain"_s,
    "events"_s,
    "module"_s,
    "stream"_s,
    "timers"_s,
    "undici"_s,
    "bun:ffi"_s,
    "bun:jsc"_s,
    "cluster"_s,
    "console"_s,
    "process"_s,
    "bun:wrap"_s,
    "punycode"_s,
    "bun:test"_s,
    "bun:main"_s,
    "readline"_s,
    "_tls_wrap"_s,
    "constants"_s,
    "inspector"_s,
    "bun:sqlite"_s,
    "path/posix"_s,
    "path/win32"_s,
    "perf_hooks"_s,
    "stream/web"_s,
    "util/types"_s,
    "_http_agent"_s,
    "_tls_common"_s,
    "async_hooks"_s,
    "detect-libc"_s,
    "fs/promises"_s,
    "querystring"_s,
    "_http_client"_s,
    "_http_common"_s,
    "_http_server"_s,
    "_stream_wrap"_s,
    "dns/promises"_s,
    "trace_events"_s,
    "assert/strict"_s,
    "child_process"_s,
    "_http_incoming"_s,
    "_http_outgoing"_s,
    "_stream_duplex"_s,
    "string_decoder"_s,
    "worker_threads"_s,
    "stream/promises"_s,
    "timers/promises"_s,
    "_stream_readable"_s,
    "_stream_writable"_s,
    "stream/consumers"_s,
    "_stream_transform"_s,
    "readline/promises"_s,
    "inspector/promises"_s,
    "_stream_passthrough"_s,
    "diagnostics_channel"_s,
};

namespace Bun {

bool isBuiltinModule(const String& namePossiblyWithNodePrefix)
{
    String name = namePossiblyWithNodePrefix;
    if (name.startsWith("node:"_s))
        name = name.substringSharingImpl(5);

    for (auto& builtinModule : builtinModuleNamesSortedLength) {
        if (name == builtinModule)
            return true;
    }
    return false;
}

} // namespace Bun
