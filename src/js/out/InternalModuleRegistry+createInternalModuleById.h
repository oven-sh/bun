JSValue InternalModuleRegistry::createInternalModuleById(JSGlobalObject* globalObject, VM& vm, Field id)
{
  switch (id) {
    // JS internal modules
    case Field::BunFFI: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "bun:ffi"_s, "bun/ffi.js"_s, InternalModuleRegistryConstants::BunFFICode);
    }
    case Field::BunSqlite: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "bun:sqlite"_s, "bun/sqlite.js"_s, InternalModuleRegistryConstants::BunSqliteCode);
    }
    case Field::InternalShared: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "internal:shared"_s, "internal/shared.js"_s, InternalModuleRegistryConstants::InternalSharedCode);
    }
    case Field::NodeAssert: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:assert"_s, "node/assert.js"_s, InternalModuleRegistryConstants::NodeAssertCode);
    }
    case Field::NodeAssertStrict: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:assert/strict"_s, "node/assert.strict.js"_s, InternalModuleRegistryConstants::NodeAssertStrictCode);
    }
    case Field::NodeAsyncHooks: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:async_hooks"_s, "node/async_hooks.js"_s, InternalModuleRegistryConstants::NodeAsyncHooksCode);
    }
    case Field::NodeChildProcess: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:child_process"_s, "node/child_process.js"_s, InternalModuleRegistryConstants::NodeChildProcessCode);
    }
    case Field::NodeCluster: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:cluster"_s, "node/cluster.js"_s, InternalModuleRegistryConstants::NodeClusterCode);
    }
    case Field::NodeCrypto: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:crypto"_s, "node/crypto.js"_s, InternalModuleRegistryConstants::NodeCryptoCode);
    }
    case Field::NodeDgram: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:dgram"_s, "node/dgram.js"_s, InternalModuleRegistryConstants::NodeDgramCode);
    }
    case Field::NodeDiagnosticsChannel: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:diagnostics_channel"_s, "node/diagnostics_channel.js"_s, InternalModuleRegistryConstants::NodeDiagnosticsChannelCode);
    }
    case Field::NodeDNS: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:dns"_s, "node/dns.js"_s, InternalModuleRegistryConstants::NodeDNSCode);
    }
    case Field::NodeDNSPromises: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:dns/promises"_s, "node/dns.promises.js"_s, InternalModuleRegistryConstants::NodeDNSPromisesCode);
    }
    case Field::NodeEvents: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:events"_s, "node/events.js"_s, InternalModuleRegistryConstants::NodeEventsCode);
    }
    case Field::NodeFS: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:fs"_s, "node/fs.js"_s, InternalModuleRegistryConstants::NodeFSCode);
    }
    case Field::NodeFSPromises: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:fs/promises"_s, "node/fs.promises.js"_s, InternalModuleRegistryConstants::NodeFSPromisesCode);
    }
    case Field::NodeHttp: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:http"_s, "node/http.js"_s, InternalModuleRegistryConstants::NodeHttpCode);
    }
    case Field::NodeHttp2: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:http2"_s, "node/http2.js"_s, InternalModuleRegistryConstants::NodeHttp2Code);
    }
    case Field::NodeHttps: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:https"_s, "node/https.js"_s, InternalModuleRegistryConstants::NodeHttpsCode);
    }
    case Field::NodeInspector: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:inspector"_s, "node/inspector.js"_s, InternalModuleRegistryConstants::NodeInspectorCode);
    }
    case Field::NodeNet: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:net"_s, "node/net.js"_s, InternalModuleRegistryConstants::NodeNetCode);
    }
    case Field::NodeOS: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:os"_s, "node/os.js"_s, InternalModuleRegistryConstants::NodeOSCode);
    }
    case Field::NodePathPosix: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:path/posix"_s, "node/path.posix.js"_s, InternalModuleRegistryConstants::NodePathPosixCode);
    }
    case Field::NodePath: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:path"_s, "node/path.js"_s, InternalModuleRegistryConstants::NodePathCode);
    }
    case Field::NodePathWin32: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:path/win32"_s, "node/path.win32.js"_s, InternalModuleRegistryConstants::NodePathWin32Code);
    }
    case Field::NodePerfHooks: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:perf_hooks"_s, "node/perf_hooks.js"_s, InternalModuleRegistryConstants::NodePerfHooksCode);
    }
    case Field::NodeReadline: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:readline"_s, "node/readline.js"_s, InternalModuleRegistryConstants::NodeReadlineCode);
    }
    case Field::NodeReadlinePromises: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:readline/promises"_s, "node/readline.promises.js"_s, InternalModuleRegistryConstants::NodeReadlinePromisesCode);
    }
    case Field::NodeRepl: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:repl"_s, "node/repl.js"_s, InternalModuleRegistryConstants::NodeReplCode);
    }
    case Field::NodeStreamConsumers: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:stream/consumers"_s, "node/stream.consumers.js"_s, InternalModuleRegistryConstants::NodeStreamConsumersCode);
    }
    case Field::NodeStream: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:stream"_s, "node/stream.js"_s, InternalModuleRegistryConstants::NodeStreamCode);
    }
    case Field::NodeStreamPromises: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:stream/promises"_s, "node/stream.promises.js"_s, InternalModuleRegistryConstants::NodeStreamPromisesCode);
    }
    case Field::NodeStreamWeb: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:stream/web"_s, "node/stream.web.js"_s, InternalModuleRegistryConstants::NodeStreamWebCode);
    }
    case Field::NodeTimers: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:timers"_s, "node/timers.js"_s, InternalModuleRegistryConstants::NodeTimersCode);
    }
    case Field::NodeTimersPromises: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:timers/promises"_s, "node/timers.promises.js"_s, InternalModuleRegistryConstants::NodeTimersPromisesCode);
    }
    case Field::NodeTLS: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:tls"_s, "node/tls.js"_s, InternalModuleRegistryConstants::NodeTLSCode);
    }
    case Field::NodeTraceEvents: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:trace_events"_s, "node/trace_events.js"_s, InternalModuleRegistryConstants::NodeTraceEventsCode);
    }
    case Field::NodeUrl: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:url"_s, "node/url.js"_s, InternalModuleRegistryConstants::NodeUrlCode);
    }
    case Field::NodeUtil: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:util"_s, "node/util.js"_s, InternalModuleRegistryConstants::NodeUtilCode);
    }
    case Field::NodeV8: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:v8"_s, "node/v8.js"_s, InternalModuleRegistryConstants::NodeV8Code);
    }
    case Field::NodeVM: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:vm"_s, "node/vm.js"_s, InternalModuleRegistryConstants::NodeVMCode);
    }
    case Field::NodeWasi: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:wasi"_s, "node/wasi.js"_s, InternalModuleRegistryConstants::NodeWasiCode);
    }
    case Field::NodeZlib: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "node:zlib"_s, "node/zlib.js"_s, InternalModuleRegistryConstants::NodeZlibCode);
    }
    case Field::ThirdpartyDepd: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "depd"_s, "thirdparty/depd.js"_s, InternalModuleRegistryConstants::ThirdpartyDepdCode);
    }
    case Field::ThirdpartyDetectLibc: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "detect-libc"_s, "thirdparty/detect-libc.js"_s, InternalModuleRegistryConstants::ThirdpartyDetectLibcCode);
    }
    case Field::ThirdpartyDetectLibcLinux: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "detect-libc/linux"_s, "thirdparty/detect-libc.linux.js"_s, InternalModuleRegistryConstants::ThirdpartyDetectLibcLinuxCode);
    }
    case Field::ThirdpartyUndici: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "undici"_s, "thirdparty/undici.js"_s, InternalModuleRegistryConstants::ThirdpartyUndiciCode);
    }
    case Field::ThirdpartyWS: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "ws"_s, "thirdparty/ws.js"_s, InternalModuleRegistryConstants::ThirdpartyWSCode);
    }
  }
}
