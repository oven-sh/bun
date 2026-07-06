#include "root.h"
#include "isBuiltinModule.h"

// Bun's own modules and its thirdparty overrides are intentionally included, so
// that passing `module.builtinModules` as the 'external' option to a bundler
// properly excludes things like 'ws', which only work with Bun's native
// implementation and not the JS one on npm.
static constexpr ASCIILiteral builtinModuleNamesTable[] = {
    "_http_agent"_s,
    "_http_client"_s,
    "_http_common"_s,
    "_http_incoming"_s,
    "_http_outgoing"_s,
    "_http_server"_s,
    "_stream_duplex"_s,
    "_stream_passthrough"_s,
    "_stream_readable"_s,
    "_stream_transform"_s,
    "_stream_wrap"_s,
    "_stream_writable"_s,
    "_tls_common"_s,
    "_tls_wrap"_s,
    "assert"_s,
    "assert/strict"_s,
    "async_hooks"_s,
    "buffer"_s,
    "bun:ffi"_s,
    "bun:jsc"_s,
    "bun:main"_s,
    "bun:sqlite"_s,
    "bun:test"_s,
    "bun:wrap"_s,
    "bun"_s,
    "child_process"_s,
    "cluster"_s,
    "console"_s,
    "constants"_s,
    "crypto"_s,
    "dgram"_s,
    "diagnostics_channel"_s,
    "dns"_s,
    "dns/promises"_s,
    "domain"_s,
    "events"_s,
    "fs"_s,
    "fs/promises"_s,
    "http"_s,
    "http2"_s,
    "https"_s,
    "inspector"_s,
    "inspector/promises"_s,
    "module"_s,
    "net"_s,
    "os"_s,
    "path"_s,
    "path/posix"_s,
    "path/win32"_s,
    "perf_hooks"_s,
    "process"_s,
    "punycode"_s,
    "querystring"_s,
    "readline"_s,
    "readline/promises"_s,
    "repl"_s,
    "stream"_s,
    "stream/consumers"_s,
    "stream/promises"_s,
    "stream/web"_s,
    "string_decoder"_s,
    "sys"_s,
    "timers"_s,
    "timers/promises"_s,
    "tls"_s,
    "trace_events"_s,
    "tty"_s,
    "undici"_s,
    "url"_s,
    "util"_s,
    "util/types"_s,
    "v8"_s,
    "vm"_s,
    "wasi"_s,
    "worker_threads"_s,
    "ws"_s,
    "zlib"_s,
    // Builtins that only resolve with the "node:" prefix. Node lists these with
    // the prefix too, since the bare name is not a builtin.
    "node:test"_s,
};

namespace Bun {

std::span<const ASCIILiteral> builtinModuleNames()
{
    return builtinModuleNamesTable;
}

bool isBuiltinModule(const String& namePossiblyWithNodePrefix)
{
    // First check the original name as-is
    for (auto& builtinModule : builtinModuleNamesTable) {
        if (namePossiblyWithNodePrefix == builtinModule)
            return true;
    }

    // If no match found and the name has a "node:" prefix, try without the prefix
    String name = namePossiblyWithNodePrefix;
    if (name.startsWith("node:"_s)) {
        name = name.substringSharingImpl(5);

        // Check again with the prefix removed
        for (auto& builtinModule : builtinModuleNamesTable) {
            if (name == builtinModule)
                return true;
        }
    }

    return false;
}

String isUnprefixedNodeBuiltin(const String& name)
{
    static constexpr ASCIILiteral unprefixedNodeBuiltinNamesSortedLength[] = {
        "fs"_s,
        "os"_s,
        "v8"_s,
        "vm"_s,
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
        "cluster"_s,
        "console"_s,
        "process"_s,
        "punycode"_s,
        "readline"_s,
        "_tls_wrap"_s,
        "constants"_s,
        "inspector"_s,
        "path/posix"_s,
        "path/win32"_s,
        "perf_hooks"_s,
        "stream/web"_s,
        "util/types"_s,
        "_http_agent"_s,
        "_tls_common"_s,
        "async_hooks"_s,
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
    static const NeverDestroyed<String> mapTo[] = {
        MAKE_STATIC_STRING_IMPL("node:fs"),
        MAKE_STATIC_STRING_IMPL("node:os"),
        MAKE_STATIC_STRING_IMPL("node:v8"),
        MAKE_STATIC_STRING_IMPL("node:vm"),
        MAKE_STATIC_STRING_IMPL("node:dns"),
        MAKE_STATIC_STRING_IMPL("node:net"),
        MAKE_STATIC_STRING_IMPL("node:sys"),
        MAKE_STATIC_STRING_IMPL("node:tls"),
        MAKE_STATIC_STRING_IMPL("node:tty"),
        MAKE_STATIC_STRING_IMPL("node:url"),
        MAKE_STATIC_STRING_IMPL("node:http"),
        MAKE_STATIC_STRING_IMPL("node:path"),
        MAKE_STATIC_STRING_IMPL("node:repl"),
        MAKE_STATIC_STRING_IMPL("node:util"),
        MAKE_STATIC_STRING_IMPL("node:wasi"),
        MAKE_STATIC_STRING_IMPL("node:zlib"),
        MAKE_STATIC_STRING_IMPL("node:dgram"),
        MAKE_STATIC_STRING_IMPL("node:http2"),
        MAKE_STATIC_STRING_IMPL("node:https"),
        MAKE_STATIC_STRING_IMPL("node:assert"),
        MAKE_STATIC_STRING_IMPL("node:buffer"),
        MAKE_STATIC_STRING_IMPL("node:crypto"),
        MAKE_STATIC_STRING_IMPL("node:domain"),
        MAKE_STATIC_STRING_IMPL("node:events"),
        MAKE_STATIC_STRING_IMPL("node:module"),
        MAKE_STATIC_STRING_IMPL("node:stream"),
        MAKE_STATIC_STRING_IMPL("node:timers"),
        MAKE_STATIC_STRING_IMPL("node:cluster"),
        MAKE_STATIC_STRING_IMPL("node:console"),
        MAKE_STATIC_STRING_IMPL("node:process"),
        MAKE_STATIC_STRING_IMPL("node:punycode"),
        MAKE_STATIC_STRING_IMPL("node:readline"),
        MAKE_STATIC_STRING_IMPL("node:_tls_wrap"),
        MAKE_STATIC_STRING_IMPL("node:constants"),
        MAKE_STATIC_STRING_IMPL("node:inspector"),
        MAKE_STATIC_STRING_IMPL("node:path/posix"),
        MAKE_STATIC_STRING_IMPL("node:path/win32"),
        MAKE_STATIC_STRING_IMPL("node:perf_hooks"),
        MAKE_STATIC_STRING_IMPL("node:stream/web"),
        MAKE_STATIC_STRING_IMPL("node:util/types"),
        MAKE_STATIC_STRING_IMPL("node:_http_agent"),
        MAKE_STATIC_STRING_IMPL("node:_tls_common"),
        MAKE_STATIC_STRING_IMPL("node:async_hooks"),
        MAKE_STATIC_STRING_IMPL("node:fs/promises"),
        MAKE_STATIC_STRING_IMPL("node:querystring"),
        MAKE_STATIC_STRING_IMPL("node:_http_client"),
        MAKE_STATIC_STRING_IMPL("node:_http_common"),
        MAKE_STATIC_STRING_IMPL("node:_http_server"),
        MAKE_STATIC_STRING_IMPL("node:_stream_wrap"),
        MAKE_STATIC_STRING_IMPL("node:dns/promises"),
        MAKE_STATIC_STRING_IMPL("node:trace_events"),
        MAKE_STATIC_STRING_IMPL("node:assert/strict"),
        MAKE_STATIC_STRING_IMPL("node:child_process"),
        MAKE_STATIC_STRING_IMPL("node:_http_incoming"),
        MAKE_STATIC_STRING_IMPL("node:_http_outgoing"),
        MAKE_STATIC_STRING_IMPL("node:_stream_duplex"),
        MAKE_STATIC_STRING_IMPL("node:string_decoder"),
        MAKE_STATIC_STRING_IMPL("node:worker_threads"),
        MAKE_STATIC_STRING_IMPL("node:stream/promises"),
        MAKE_STATIC_STRING_IMPL("node:timers/promises"),
        MAKE_STATIC_STRING_IMPL("node:_stream_readable"),
        MAKE_STATIC_STRING_IMPL("node:_stream_writable"),
        MAKE_STATIC_STRING_IMPL("node:stream/consumers"),
        MAKE_STATIC_STRING_IMPL("node:_stream_transform"),
        MAKE_STATIC_STRING_IMPL("node:readline/promises"),
        MAKE_STATIC_STRING_IMPL("node:inspector/promises"),
        MAKE_STATIC_STRING_IMPL("node:_stream_passthrough"),
        MAKE_STATIC_STRING_IMPL("node:diagnostics_channel"),
    };
    for (size_t i = 0; i < std::size(unprefixedNodeBuiltinNamesSortedLength); i++) {
        if (name == unprefixedNodeBuiltinNamesSortedLength[i]) {
            return mapTo[i];
        }
    }
    return String();
}

} // namespace Bun
