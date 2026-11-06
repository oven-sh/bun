// Walks every object that own keys and prototypes reach from the global object and from the built-in modules.
// Prints a line for each function: where it was found, and its own properties `name`, `length` and `prototype`.
const found = new Set();
const queue = [];
const lines = [];
const show = key => (typeof key === "symbol" ? `[${key.description}]` : key);
const flagsOf = ({ writable, enumerable, configurable }) => [writable, enumerable, configurable].map(Number).join("");
const describe = (fn, key) => {
  const descriptor = Reflect.getOwnPropertyDescriptor(fn, key);
  if (!descriptor) return "none";
  if (!("value" in descriptor)) return "accessor " + flagsOf(descriptor);
  const { value } = descriptor;
  return (Object(value) === value ? typeof value : JSON.stringify(value)) + " " + flagsOf(descriptor);
};
// What these hold goes by the machine and by how the program was started.
// A compiled program has no ShadowRealm.
const passedOver = new Set([
  "globalThis.process.env",
  "globalThis.Bun.env",
  "globalThis.process.mainModule",
  "globalThis.ShadowRealm",
]);
const visit = (value, path) => {
  if (Object(value) !== value || found.has(value) || passedOver.has(path)) return;
  found.add(value);
  queue.push([value, path]);
};

visit(globalThis, "globalThis");
// Named here, so that the executable holds them.
visit(Bun.$, "Bun.$");
visit(Bun.sql, "Bun.sql");
visit(Bun.SQL, "Bun.SQL");
visit(Bun.postgres, "Bun.postgres");
visit(require("@vercel/fetch"), "@vercel/fetch");
visit(require("bun:ffi"), "bun:ffi");
visit(require("bun:jsc"), "bun:jsc");
visit(require("bun:sqlite"), "bun:sqlite");
visit(require("bun:wrap"), "bun:wrap");
visit(require("isomorphic-fetch"), "isomorphic-fetch");
visit(require("node-fetch"), "node-fetch");
visit(require("node:_http_agent"), "node:_http_agent");
visit(require("node:_http_client"), "node:_http_client");
visit(require("node:_http_common"), "node:_http_common");
visit(require("node:_http_incoming"), "node:_http_incoming");
visit(require("node:_http_outgoing"), "node:_http_outgoing");
visit(require("node:_http_server"), "node:_http_server");
visit(require("node:_stream_duplex"), "node:_stream_duplex");
visit(require("node:_stream_passthrough"), "node:_stream_passthrough");
visit(require("node:_stream_readable"), "node:_stream_readable");
visit(require("node:_stream_transform"), "node:_stream_transform");
visit(require("node:_stream_wrap"), "node:_stream_wrap");
visit(require("node:_stream_writable"), "node:_stream_writable");
visit(require("node:_tls_common"), "node:_tls_common");
visit(require("node:_tls_wrap"), "node:_tls_wrap");
visit(require("node:assert"), "node:assert");
visit(require("node:assert/strict"), "node:assert/strict");
visit(require("node:async_hooks"), "node:async_hooks");
visit(require("node:buffer"), "node:buffer");
visit(require("node:child_process"), "node:child_process");
visit(require("node:cluster"), "node:cluster");
visit(require("node:console"), "node:console");
visit(require("node:constants"), "node:constants");
visit(require("node:crypto"), "node:crypto");
visit(require("node:dgram"), "node:dgram");
visit(require("node:diagnostics_channel"), "node:diagnostics_channel");
visit(require("node:dns"), "node:dns");
visit(require("node:dns/promises"), "node:dns/promises");
visit(require("node:domain"), "node:domain");
visit(require("node:events"), "node:events");
visit(require("node:fs"), "node:fs");
visit(require("node:fs/promises"), "node:fs/promises");
visit(require("node:http"), "node:http");
visit(require("node:http2"), "node:http2");
visit(require("node:https"), "node:https");
visit(require("node:module"), "node:module");
visit(require("node:net"), "node:net");
visit(require("node:os"), "node:os");
visit(require("node:path"), "node:path");
visit(require("node:path/posix"), "node:path/posix");
visit(require("node:path/win32"), "node:path/win32");
visit(require("node:perf_hooks"), "node:perf_hooks");
visit(require("node:punycode"), "node:punycode");
visit(require("node:querystring"), "node:querystring");
visit(require("node:readline"), "node:readline");
visit(require("node:readline/promises"), "node:readline/promises");
visit(require("node:stream"), "node:stream");
visit(require("node:stream/consumers"), "node:stream/consumers");
visit(require("node:stream/promises"), "node:stream/promises");
visit(require("node:stream/web"), "node:stream/web");
visit(require("node:string_decoder"), "node:string_decoder");
visit(require("node:timers"), "node:timers");
visit(require("node:timers/promises"), "node:timers/promises");
visit(require("node:tls"), "node:tls");
visit(require("node:tty"), "node:tty");
visit(require("node:url"), "node:url");
visit(require("node:util"), "node:util");
visit(require("node:util/types"), "node:util/types");
visit(require("node:v8"), "node:v8");
visit(require("node:vm"), "node:vm");
visit(require("node:worker_threads"), "node:worker_threads");
visit(require("node:zlib"), "node:zlib");
visit(require("undici"), "undici");
visit(require("utf-8-validate"), "utf-8-validate");
visit(require("ws"), "ws");

while (queue.length) {
  const [value, path] = queue.shift();
  if (path.split(".").length > 7) continue;
  if (typeof value === "function")
    lines.push([path, ...["name", "length", "prototype"].map(key => key + " " + describe(value, key))].join("  "));
  if (Array.isArray(value) || ArrayBuffer.isView(value)) continue;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    const at = path + "." + show(key);
    visit(descriptor.value, at);
    visit(descriptor.get, at + "<get>");
    visit(descriptor.set, at + "<set>");
  }
  visit(Reflect.getPrototypeOf(value), path + ".__proto__");
}
console.log(lines.join("\n"));
