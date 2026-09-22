// State the feature modules share, all of it created on first use: node
// builtins are imported only by the features that use them, the local servers
// (servers.js, an untraced child) start when a feature first needs one, and so
// does the temporary directory.
import { startServers } from "./servers.js";
/** Where the generator wrote the TLS certificates the servers present and the clients trust. */
const here = process.env.ORDERFILE_APP_DATA;
const BUILTINS = {
  fs: () => import("node:fs"),
  fsp: () => import("node:fs/promises"),
  path: () => import("node:path"),
  os: () => import("node:os"),
  http: () => import("node:http"),
  https: () => import("node:https"),
  net: () => import("node:net"),
  tls: () => import("node:tls"),
  dns: () => import("node:dns"),
  zlib: () => import("node:zlib"),
  crypto: () => import("node:crypto"),
  util: () => import("node:util"),
  vm: () => import("node:vm"),
  cp: () => import("node:child_process"),
  events: () => import("node:events"),
  stream: () => import("node:stream"),
  streamp: () => import("node:stream/promises"),
  timersp: () => import("node:timers/promises"),
  async_hooks: () => import("node:async_hooks"),
  string_decoder: () => import("node:string_decoder"),
  assert: () => import("node:assert"),
  module: () => import("node:module"),
  url: () => import("node:url"),
  querystring: () => import("node:querystring"),
  tty: () => import("node:tty"),
  dc: () => import("node:diagnostics_channel"),
  perf_hooks: () => import("node:perf_hooks"),
  worker_threads: () => import("node:worker_threads"),
};
/** Imports the named builtins (keys of BUILTINS) and returns them by that name, default export where there is one. */
export async function need(...names) {
  const out = {};
  for (const name of names) {
    const module = await BUILTINS[name]();
    out[name] = module.default ?? module;
  }
  return out;
}
let _srv, _tmp, _socketDir;
export async function servers() {
  return (_srv ??= startServers());
}
export async function stopServers() {
  if (_srv) (await _srv).stop();
}
export async function tmpdir() {
  if (_tmp) return _tmp;
  const { fs, path, os } = await need("fs", "path", "os");
  return (_tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orderfile-app-")));
}
/**
 * A path for a unix socket. sun_path holds ~104 bytes and macOS's temporary
 * directory alone is half of that, so a long one falls back to /tmp.
 */
export async function socketPath(name) {
  const { fs, path } = await need("fs", "path");
  const inTmp = path.join(await tmpdir(), name);
  if (inTmp.length < 100) return inTmp;
  _socketDir ??= fs.mkdtempSync("/tmp/orderfile-");
  return path.join(_socketDir, name);
}
/**
 * Generous next to what the exchanges take (well under a second, traced): they
 * run eight at a time on a CI machine, and the required ones fail the order file.
 */
export const SOCKET_DEADLINE_MS = 30_000;

/**
 * How many bytes `socket` received by the time it closed. Rejects if it fails,
 * closes without having received anything, or is still open at the deadline.
 */
export function drained(socket, label) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const deadline = setTimeout(
      () => socket.destroy(new Error(`${label}: still open after ${SOCKET_DEADLINE_MS / 1000} s`)),
      SOCKET_DEADLINE_MS,
    );
    socket.on("data", chunk => (received += chunk.length));
    socket.on("error", reject);
    socket.on("close", () => {
      clearTimeout(deadline);
      if (received > 0) resolve(received);
      else reject(new Error(`${label}: closed without a response`));
    });
  });
}

/** The first chunk `socket` receives. Rejects if it fails, closes first, or has received nothing at the deadline. */
export function firstChunk(socket, label) {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(
      () => socket.destroy(new Error(`${label}: nothing after ${SOCKET_DEADLINE_MS / 1000} s`)),
      SOCKET_DEADLINE_MS,
    );
    const settle = (settleWith, value) => {
      clearTimeout(deadline);
      socket.off("error", reject);
      socket.off("close", closed);
      settleWith(value);
    };
    const closed = () => settle(reject, new Error(`${label}: closed without a response`));
    socket.once("data", chunk => settle(resolve, chunk));
    socket.once("error", reject);
    socket.once("close", closed);
  });
}

export async function cleanTmp() {
  const { fs } = await need("fs");
  for (const dir of [_tmp, _socketDir]) if (dir) fs.rmSync(dir, { recursive: true, force: true });
}
export async function cert(name = "cert.pem") {
  const { fs, path } = await need("fs", "path");
  return fs.readFileSync(path.join(here, name), "utf8");
}
export async function base() {
  const s = await servers();
  return `http://127.0.0.1:${s.plainBun}`;
}
let _big;
export const bigObj = () =>
  (_big ??= {
    data: Array.from({ length: 2000 }, (_, i) => ({ id: i, text: "chunk " + i, meta: { t: 1.7e12 + i, ok: true } })),
  });
