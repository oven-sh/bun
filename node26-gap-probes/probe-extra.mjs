// Extra probes: in-window doc entries Dylan's 97-list didn't cover.
const out = {};
function t(id, fn) {
  try {
    out[id] = fn();
  } catch (e) {
    out[id] = `ERR:${e.code || e.name}:${String(e.message).slice(0, 80)}`;
  }
}
function req(m) {
  try {
    return require(m);
  } catch {
    return undefined;
  }
}
const proto = (C) => C?.prototype;
const has = (o, p) => (o ? (Object.getOwnPropertyDescriptor(o, p) ? "own" : p in o ? "inherited" : "missing") : "no-object");

t("global.ErrorEvent", () => typeof globalThis.ErrorEvent);

{
  const ph = req("node:perf_hooks");
  t("perf_hooks.eventLoopUtilization", () => typeof ph.eventLoopUtilization);
  t("perf_hooks.timerify", () => typeof ph.timerify);
}
{
  const net = req("node:net");
  t("net.Socket#getTypeOfService", () => has(proto(net.Socket), "getTypeOfService"));
  t("net.Socket#setTypeOfService", () => has(proto(net.Socket), "setTypeOfService"));
}
{
  const vm = req("node:vm");
  t("vm.SourceTextModule", () => typeof vm.SourceTextModule);
  t("vm.SourceTextModule#hasAsyncGraph", () => has(proto(vm.SourceTextModule), "hasAsyncGraph"));
  t("vm.SourceTextModule#hasTopLevelAwait", () => has(proto(vm.SourceTextModule), "hasTopLevelAwait"));
}
{
  const sc = req("node:stream/consumers");
  t("stream/consumers.bytes", () => typeof sc.bytes);
}
{
  const fs = req("node:fs");
  t("fsPromises.mkdtempDisposable", () => typeof fs.promises.mkdtempDisposable);
  t("fs.mkdtempDisposableSync", () => typeof fs.mkdtempDisposableSync);
  t("fs.Utf8Stream", () => typeof fs.Utf8Stream);
  t("fs.statfs.frsize", () => {
    const s = fs.statfsSync("/");
    return "frsize" in s ? `present:${typeof s.frsize}` : "missing";
  });
}
{
  const u = req("node:util");
  t("util.convertProcessSignalToExitCode", () => typeof u.convertProcessSignalToExitCode);
}
{
  const http = req("node:http");
  t("http.setGlobalProxyFromEnv", () => typeof http.setGlobalProxyFromEnv);
  t("http.ServerResponse#writeInformation", () => has(proto(http.ServerResponse), "writeInformation"));
  t("http.IncomingMessage#signal", () => has(proto(http.IncomingMessage), "signal"));
  const http2 = req("node:http2");
  t("http2.Http2ServerResponse#writeInformation", () => has(proto(http2.Http2ServerResponse), "writeInformation"));
}
{
  const c = req("node:crypto");
  t("crypto.randomUUIDv7", () => typeof c.randomUUIDv7);
  t("crypto.X509Certificate#signatureAlgorithm", () => has(proto(c.X509Certificate), "signatureAlgorithm"));
  t("crypto.X509Certificate#signatureAlgorithmOid", () => has(proto(c.X509Certificate), "signatureAlgorithmOid"));
}
{
  const sq = req("node:sqlite");
  if (sq) {
    const p = proto(sq.DatabaseSync);
    for (const m of ["enableDefensive", "setAuthorizer", "limits", "serialize", "deserialize", "createTagStore"])
      t(`sqlite.DatabaseSync#${m}`, () => has(p, m));
    t("sqlite.Session#Symbol.dispose", () => (sq.Session ? has(proto(sq.Session), Symbol.dispose) : "no Session export"));
  } else t("sqlite(module)", () => "no-module");
}
t("quic(module)", () => (req("node:quic") ? "exists" : "no-module"));
{
  const nt = req("node:test");
  t("test(module)", () => (nt ? "exists" : "no-module"));
  if (nt) {
    t("test.exports", () => Object.keys(nt).sort().join(","));
    t("test.getTestContext", () => typeof nt.getTestContext);
  }
}
{
  const stream = req("node:stream");
  t("stream.Readable#Symbol(Stream.toAsyncStreamable)", () =>
    has(proto(stream.Readable), Symbol.for("Stream.toAsyncStreamable")),
  );
}
// FileHandle methods need an open handle
{
  const fsp = req("node:fs/promises");
  const fh = await fsp.open("/etc/hostname", "r").catch(() => null);
  if (fh) {
    for (const m of ["pull", "pullSync", "writer"]) t(`fs.FileHandle#${m}`, () => (m in fh ? typeof fh[m] : "missing"));
    await fh.close();
  }
}

console.log(
  JSON.stringify(
    { runtime: typeof Bun !== "undefined" ? "bun" : "node", revision: typeof Bun !== "undefined" ? Bun.revision : null, flags: process.execArgv, results: out },
    null,
    2,
  ),
);
