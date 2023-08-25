// clang-format off
JSValue InternalModuleRegistry::createInternalModuleById(JSGlobalObject* globalObject, VM& vm, Field id)
{
  switch (id) {
    // JS internal modules
    case Field::BunFFI: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "bun:ffi"_s, "bun/ffi.js"_s, InternalModuleRegistryConstants::BunFFICode, "builtin://bun/ffi"_s);
    }
    case Field::BunSqlite: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "bun:sqlite"_s, "bun/sqlite.js"_s, InternalModuleRegistryConstants::BunSqliteCode, "builtin://bun/sqlite"_s);
    }
    case Field::InternalDebugger: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "internal:debugger"_s, "internal/debugger.js"_s, InternalModuleRegistryConstants::InternalDebuggerCode, "builtin://internal/debugger"_s);
    }
    case Field::InternalFSCpSync: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "internal:fs/cp-sync"_s, "internal/fs/cp-sync.js"_s, InternalModuleRegistryConstants::InternalFSCpSyncCode, "builtin://internal/fs/cp/sync"_s);
    }
    case Field::InternalFSCp: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "internal:fs/cp"_s, "internal/fs/cp.js"_s, InternalModuleRegistryConstants::InternalFSCpCode, "builtin://internal/fs/cp"_s);
    }
    case Field::InternalShared: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "internal:shared"_s, "internal/shared.js"_s, InternalModuleRegistryConstants::InternalSharedCode, "builtin://internal/shared"_s);
    }
    case Field::NodeAssert: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:assert"_s, "node/assert.js"_s, InternalModuleRegistryConstants::NodeAssertCode, "builtin://node/assert"_s);
    }
    case Field::NodeAssertStrict: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:assert/strict"_s, "node/assert.strict.js"_s, InternalModuleRegistryConstants::NodeAssertStrictCode, "builtin://node/assert/strict"_s);
    }
    case Field::NodeAsyncHooks: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:async_hooks"_s, "node/async_hooks.js"_s, InternalModuleRegistryConstants::NodeAsyncHooksCode, "builtin://node/async/hooks"_s);
    }
    case Field::NodeChildProcess: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:child_process"_s, "node/child_process.js"_s, InternalModuleRegistryConstants::NodeChildProcessCode, "builtin://node/child/process"_s);
    }
    case Field::NodeCluster: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:cluster"_s, "node/cluster.js"_s, InternalModuleRegistryConstants::NodeClusterCode, "builtin://node/cluster"_s);
    }
    case Field::NodeConsole: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:console"_s, "node/console.js"_s, InternalModuleRegistryConstants::NodeConsoleCode, "builtin://node/console"_s);
    }
    case Field::NodeCrypto: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:crypto"_s, "node/crypto.js"_s, InternalModuleRegistryConstants::NodeCryptoCode, "builtin://node/crypto"_s);
    }
    case Field::NodeDgram: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:dgram"_s, "node/dgram.js"_s, InternalModuleRegistryConstants::NodeDgramCode, "builtin://node/dgram"_s);
    }
    case Field::NodeDiagnosticsChannel: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:diagnostics_channel"_s, "node/diagnostics_channel.js"_s, InternalModuleRegistryConstants::NodeDiagnosticsChannelCode, "builtin://node/diagnostics/channel"_s);
    }
    case Field::NodeDNS: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:dns"_s, "node/dns.js"_s, InternalModuleRegistryConstants::NodeDNSCode, "builtin://node/dns"_s);
    }
    case Field::NodeDNSPromises: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:dns/promises"_s, "node/dns.promises.js"_s, InternalModuleRegistryConstants::NodeDNSPromisesCode, "builtin://node/dns/promises"_s);
    }
    case Field::NodeDomain: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:domain"_s, "node/domain.js"_s, InternalModuleRegistryConstants::NodeDomainCode, "builtin://node/domain"_s);
    }
    case Field::NodeEvents: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:events"_s, "node/events.js"_s, InternalModuleRegistryConstants::NodeEventsCode, "builtin://node/events"_s);
    }
    case Field::NodeFS: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:fs"_s, "node/fs.js"_s, InternalModuleRegistryConstants::NodeFSCode, "builtin://node/fs"_s);
    }
    case Field::NodeFSPromises: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:fs/promises"_s, "node/fs.promises.js"_s, InternalModuleRegistryConstants::NodeFSPromisesCode, "builtin://node/fs/promises"_s);
    }
    case Field::NodeHttp: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:http"_s, "node/http.js"_s, InternalModuleRegistryConstants::NodeHttpCode, "builtin://node/http"_s);
    }
    case Field::NodeHttp2: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:http2"_s, "node/http2.js"_s, InternalModuleRegistryConstants::NodeHttp2Code, "builtin://node/http2"_s);
    }
    case Field::NodeHttps: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:https"_s, "node/https.js"_s, InternalModuleRegistryConstants::NodeHttpsCode, "builtin://node/https"_s);
    }
    case Field::NodeInspector: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:inspector"_s, "node/inspector.js"_s, InternalModuleRegistryConstants::NodeInspectorCode, "builtin://node/inspector"_s);
    }
    case Field::NodeNet: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:net"_s, "node/net.js"_s, InternalModuleRegistryConstants::NodeNetCode, "builtin://node/net"_s);
    }
    case Field::NodeOS: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:os"_s, "node/os.js"_s, InternalModuleRegistryConstants::NodeOSCode, "builtin://node/os"_s);
    }
    case Field::NodePathPosix: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:path/posix"_s, "node/path.posix.js"_s, InternalModuleRegistryConstants::NodePathPosixCode, "builtin://node/path/posix"_s);
    }
    case Field::NodePath: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:path"_s, "node/path.js"_s, InternalModuleRegistryConstants::NodePathCode, "builtin://node/path"_s);
    }
    case Field::NodePathWin32: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:path/win32"_s, "node/path.win32.js"_s, InternalModuleRegistryConstants::NodePathWin32Code, "builtin://node/path/win32"_s);
    }
    case Field::NodePerfHooks: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:perf_hooks"_s, "node/perf_hooks.js"_s, InternalModuleRegistryConstants::NodePerfHooksCode, "builtin://node/perf/hooks"_s);
    }
    case Field::NodePunycode: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:punycode"_s, "node/punycode.js"_s, InternalModuleRegistryConstants::NodePunycodeCode, "builtin://node/punycode"_s);
    }
    case Field::NodeQuerystring: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:querystring"_s, "node/querystring.js"_s, InternalModuleRegistryConstants::NodeQuerystringCode, "builtin://node/querystring"_s);
    }
    case Field::NodeReadline: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:readline"_s, "node/readline.js"_s, InternalModuleRegistryConstants::NodeReadlineCode, "builtin://node/readline"_s);
    }
    case Field::NodeReadlinePromises: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:readline/promises"_s, "node/readline.promises.js"_s, InternalModuleRegistryConstants::NodeReadlinePromisesCode, "builtin://node/readline/promises"_s);
    }
    case Field::NodeRepl: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:repl"_s, "node/repl.js"_s, InternalModuleRegistryConstants::NodeReplCode, "builtin://node/repl"_s);
    }
    case Field::NodeStreamConsumers: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:stream/consumers"_s, "node/stream.consumers.js"_s, InternalModuleRegistryConstants::NodeStreamConsumersCode, "builtin://node/stream/consumers"_s);
    }
    case Field::NodeStream: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:stream"_s, "node/stream.js"_s, InternalModuleRegistryConstants::NodeStreamCode, "builtin://node/stream"_s);
    }
    case Field::NodeStreamPromises: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:stream/promises"_s, "node/stream.promises.js"_s, InternalModuleRegistryConstants::NodeStreamPromisesCode, "builtin://node/stream/promises"_s);
    }
    case Field::NodeStreamWeb: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:stream/web"_s, "node/stream.web.js"_s, InternalModuleRegistryConstants::NodeStreamWebCode, "builtin://node/stream/web"_s);
    }
    case Field::NodeTimers: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:timers"_s, "node/timers.js"_s, InternalModuleRegistryConstants::NodeTimersCode, "builtin://node/timers"_s);
    }
    case Field::NodeTimersPromises: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:timers/promises"_s, "node/timers.promises.js"_s, InternalModuleRegistryConstants::NodeTimersPromisesCode, "builtin://node/timers/promises"_s);
    }
    case Field::NodeTLS: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:tls"_s, "node/tls.js"_s, InternalModuleRegistryConstants::NodeTLSCode, "builtin://node/tls"_s);
    }
    case Field::NodeTraceEvents: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:trace_events"_s, "node/trace_events.js"_s, InternalModuleRegistryConstants::NodeTraceEventsCode, "builtin://node/trace/events"_s);
    }
    case Field::NodeTty: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:tty"_s, "node/tty.js"_s, InternalModuleRegistryConstants::NodeTtyCode, "builtin://node/tty"_s);
    }
    case Field::NodeUrl: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:url"_s, "node/url.js"_s, InternalModuleRegistryConstants::NodeUrlCode, "builtin://node/url"_s);
    }
    case Field::NodeUtil: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:util"_s, "node/util.js"_s, InternalModuleRegistryConstants::NodeUtilCode, "builtin://node/util"_s);
    }
    case Field::NodeV8: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:v8"_s, "node/v8.js"_s, InternalModuleRegistryConstants::NodeV8Code, "builtin://node/v8"_s);
    }
    case Field::NodeVM: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:vm"_s, "node/vm.js"_s, InternalModuleRegistryConstants::NodeVMCode, "builtin://node/vm"_s);
    }
    case Field::NodeWasi: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:wasi"_s, "node/wasi.js"_s, InternalModuleRegistryConstants::NodeWasiCode, "builtin://node/wasi"_s);
    }
    case Field::NodeWorkerThreads: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:worker_threads"_s, "node/worker_threads.js"_s, InternalModuleRegistryConstants::NodeWorkerThreadsCode, "builtin://node/worker/threads"_s);
    }
    case Field::NodeZlib: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:zlib"_s, "node/zlib.js"_s, InternalModuleRegistryConstants::NodeZlibCode, "builtin://node/zlib"_s);
    }
    case Field::ThirdpartyDepd: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "depd"_s, "thirdparty/depd.js"_s, InternalModuleRegistryConstants::ThirdpartyDepdCode, "builtin://thirdparty/depd"_s);
    }
    case Field::ThirdpartyDetectLibc: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "detect-libc"_s, "thirdparty/detect-libc.js"_s, InternalModuleRegistryConstants::ThirdpartyDetectLibcCode, "builtin://thirdparty/detect/libc"_s);
    }
    case Field::ThirdpartyDetectLibcLinux: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "detect-libc/linux"_s, "thirdparty/detect-libc.linux.js"_s, InternalModuleRegistryConstants::ThirdpartyDetectLibcLinuxCode, "builtin://thirdparty/detect/libc/linux"_s);
    }
    case Field::ThirdpartyIsomorphicFetch: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "isomorphic-fetch"_s, "thirdparty/isomorphic-fetch.js"_s, InternalModuleRegistryConstants::ThirdpartyIsomorphicFetchCode, "builtin://thirdparty/isomorphic/fetch"_s);
    }
    case Field::ThirdpartyNodeFetch: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node-fetch"_s, "thirdparty/node-fetch.js"_s, InternalModuleRegistryConstants::ThirdpartyNodeFetchCode, "builtin://thirdparty/node/fetch"_s);
    }
    case Field::ThirdpartyUndici: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "undici"_s, "thirdparty/undici.js"_s, InternalModuleRegistryConstants::ThirdpartyUndiciCode, "builtin://thirdparty/undici"_s);
    }
    case Field::ThirdpartyVercelFetch: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "vercel_fetch"_s, "thirdparty/vercel_fetch.js"_s, InternalModuleRegistryConstants::ThirdpartyVercelFetchCode, "builtin://thirdparty/vercel/fetch"_s);
    }
    case Field::ThirdpartyWS: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "ws"_s, "thirdparty/ws.js"_s, InternalModuleRegistryConstants::ThirdpartyWSCode, "builtin://thirdparty/ws"_s);
    }
  }
}
