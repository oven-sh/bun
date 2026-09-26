// Writes src/errno/host_tables.rs: the numbers of errors and signals that JavaScript sees on the hosts of the
// portable image that are not Linux.
//
//   bun misctools/portable/image/gen-host-tables.ts [--libc=<source directory of the libc crate>]
//
// The image has the error and signal numbers of Linux inside, on every host. `os.constants`, `err.errno` and
// the signal numbers of `process.kill` are those of the host in Node.js. No header of macOS or Windows can be
// read where the image is compiled, so the numbers are data, taken from:
//
//   names of os.constants   src/jsc/bindings/ProcessBindingConstants.cpp (the list of Node's node_constants.cc)
//   Linux                   src/errno/linux_errno.rs; signals: the libc crate, x86_64-unknown-linux-musl
//   macOS errors            src/errno/darwin_errno.rs, and the libc crate has to agree with it
//   macOS signals, dlopen   the libc crate, apple
//   Windows errno.h         the libc crate, windows (the numbers of the Universal CRT)
//   Windows WSA errors      src/windows_sys/externs.rs
//   Windows err.errno       src/jsc/bindings/libuv/uv/errno.h: the value libuv gives an error where the platform
//                           has none of its own, which on Windows is every error
//   Windows signals         the libc crate, windows; SIGHUP, SIGQUIT, SIGKILL, SIGWINCH: src/libuv_sys/libuv.rs;
//                           SIGBREAK: 21 in <signal.h> of the Universal CRT, written here (no file of this
//                           repository or of the libc crate has it)
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "../../..");
const libcArgument = process.argv.find(a => a.startsWith("--libc="))?.slice("--libc=".length);

function findLibc(): string {
  if (libcArgument !== undefined) return libcArgument;
  const version = /name = "libc"\nversion = "([^"]+)"/.exec(readFileSync(join(root, "Cargo.lock"), "utf8"))?.[1];
  if (version === undefined) throw new Error("Cargo.lock names no libc crate");
  const registry = join(process.env.CARGO_HOME ?? join(homedir(), ".cargo"), "registry/src");
  for (const index of readdirSync(registry)) {
    const dir = join(registry, index, `libc-${version}`, "src");
    if (existsSync(dir)) return dir;
  }
  throw new Error(`libc ${version} is not in ${registry}: run cargo fetch, or pass --libc=<dir>`);
}
const libc = findLibc();

/** `pub const NAME: c_int = <number or other NAME>;` of Rust sources; a later file wins over an earlier one. */
function rustConstants(
  files: string[],
  pattern = /^\s*pub const ([A-Z0-9_]+): (?:c_int|crate::c_int|Win32Error) = (?:Win32Error\()?([^;()]+)\)?;/gm,
) {
  const raw = new Map<string, string>();
  for (const file of files) {
    for (const m of readFileSync(file, "utf8").matchAll(pattern)) raw.set(m[1]!, m[2]!.trim());
  }
  const values = new Map<string, number>();
  const resolve = (name: string, depth = 0): number | undefined => {
    const text = raw.get(name);
    if (text === undefined || depth > 4) return undefined;
    if (/^(0x[0-9a-fA-F]+|-?\d+)$/.test(text)) return Number(text);
    if (/^[A-Z0-9_]+$/.test(text)) return resolve(text, depth + 1);
    return undefined;
  };
  for (const name of raw.keys()) {
    const value = resolve(name);
    if (value !== undefined) values.set(name, value);
  }
  return values;
}

/** `NAME = number,` of the enum SystemErrno of src/errno/<os>_errno.rs. */
function systemErrno(file: string): Map<string, number> {
  const source = readFileSync(join(root, file), "utf8");
  const body = /pub enum SystemErrno \{([^}]*)\}/.exec(source)?.[1];
  if (body === undefined) throw new Error(`${file}: no enum SystemErrno`);
  const values = new Map<string, number>();
  for (const m of body.matchAll(/^\s*([A-Z0-9_]+) = (\d+),/gm)) values.set(m[1]!, Number(m[2]));
  return values;
}

/** The names between `kConstants<n>[] = {` and its end in ProcessBindingConstants.cpp, in their order. */
function nodeNames(table: number): string[] {
  const source = readFileSync(join(root, "src/jsc/bindings/ProcessBindingConstants.cpp"), "utf8");
  const start = source.indexOf(`kConstants${table}[] = {`);
  const end = source.indexOf("{ nullptr, 0 }", start);
  if (start < 0 || end < 0) throw new Error(`kConstants${table} not found`);
  return [...source.slice(start, end).matchAll(/\{ "([A-Z0-9_]+)",/g)].map(m => m[1]!);
}

const linuxErrno = systemErrno("src/errno/linux_errno.rs");
const darwinErrno = systemErrno("src/errno/darwin_errno.rs");
const apple = rustConstants([
  join(libc, "unix/mod.rs"),
  join(libc, "unix/bsd/mod.rs"),
  join(libc, "unix/bsd/apple/mod.rs"),
]);
const linux = rustConstants([
  join(libc, "unix/mod.rs"),
  join(libc, "unix/linux_like/mod.rs"),
  join(libc, "unix/linux_like/linux/mod.rs"),
  join(libc, "unix/linux_like/linux/arch/generic/mod.rs"),
  join(libc, "unix/linux_like/linux/musl/mod.rs"),
  join(libc, "unix/linux_like/linux/musl/b64/mod.rs"),
  join(libc, "unix/linux_like/linux/musl/b64/x86_64/mod.rs"),
]);
const windowsCrt = rustConstants([join(libc, "windows/mod.rs")]);
const windowsSockets = rustConstants([join(root, "src/windows_sys/externs.rs")]);
const libuvSignals = rustConstants([join(root, "src/libuv_sys/libuv.rs")]);

// What libuv calls an error on a platform that does not have it.
const uvOfName = new Map<string, number>();
{
  const source = readFileSync(join(root, "src/jsc/bindings/libuv/uv/errno.h"), "utf8");
  for (const m of source.matchAll(/#\s*else\s*\n#\s*define UV__(E[A-Z0-9_]+) \((-\d+)\)/g))
    uvOfName.set(m[1]!, Number(m[2]));
}

// bun's table of macOS errors and the libc crate are two sources for the same numbers.
for (const [name, value] of darwinErrno) {
  const other = apple.get(name);
  if (name !== "SUCCESS" && other !== undefined && other !== value) {
    throw new Error(`${name}: ${value} in src/errno/darwin_errno.rs, ${other} in the libc crate`);
  }
}

const errnoNames = nodeNames(2);
const signalNames = nodeNames(3);
const dlopenNames = nodeNames(5);

const windowsSignals = new Map<string, number>();
for (const name of signalNames) {
  const value =
    windowsCrt.get(name) ??
    (["SIGHUP", "SIGQUIT", "SIGKILL", "SIGWINCH"].includes(name) ? libuvSignals.get(name) : undefined);
  if (value !== undefined) windowsSignals.set(name, value);
}
windowsSignals.set("SIGBREAK", 21);

type Table = [string, number][];
const inNodeOrder = (names: string[], values: (name: string) => number | undefined): Table =>
  names.flatMap(name => {
    const value = values(name);
    return value === undefined ? [] : [[name, value] as [string, number]];
  });

const tables: Record<string, Table> = {
  DARWIN_ERRNO: inNodeOrder(errnoNames, name => darwinErrno.get(name) ?? apple.get(name)),
  WINDOWS_ERRNO: inNodeOrder(errnoNames, name =>
    name.startsWith("WSA") ? windowsSockets.get(name) : windowsCrt.get(name),
  ),
  DARWIN_SIGNALS: inNodeOrder(signalNames, name => apple.get(name)),
  WINDOWS_SIGNALS: inNodeOrder(signalNames, name => windowsSignals.get(name)),
  DARWIN_DLOPEN: inNodeOrder(dlopenNames, name => apple.get(name)),
  WINDOWS_DLOPEN: [],
};

// By the number that Linux has for it: what the host has for the error or the signal of the same name.
const maxErrno = Math.max(...linuxErrno.values());
const darwinOfLinux = new Array<number>(maxErrno + 1).fill(0);
const uvOfLinux = new Array<number>(maxErrno + 1).fill(0);
for (const [name, number] of linuxErrno) {
  if (name === "SUCCESS") continue;
  // Two names of one number on Linux (EAGAIN and EWOULDBLOCK, EDEADLK and EDEADLOCK): the first one that the
  // host has decides.
  if (darwinOfLinux[number] === 0) darwinOfLinux[number] = darwinErrno.get(name) ?? 0;
  if (uvOfLinux[number] === 0) uvOfLinux[number] = uvOfName.get(name) ?? 0;
}
const linuxSignals = inNodeOrder(signalNames, name => linux.get(name));
const maxSignal = Math.max(...linuxSignals.map(([, n]) => n));
const darwinSignalOfLinux = new Array<number>(maxSignal + 1).fill(0);
const windowsSignalOfLinux = new Array<number>(maxSignal + 1).fill(0);
for (const [name, number] of linuxSignals) {
  if (darwinSignalOfLinux[number] === 0) darwinSignalOfLinux[number] = apple.get(name) ?? 0;
  if (windowsSignalOfLinux[number] === 0) windowsSignalOfLinux[number] = windowsSignals.get(name) ?? 0;
}

const lines: string[] = [];
lines.push("// GENERATED by misctools/portable/image/gen-host-tables.ts, which names the source of every number.");
lines.push("// Do not edit.");
lines.push("");
lines.push("/// A name of `os.constants` and its number on one host.");
lines.push("pub type Entry = (&'static str, i32);");
for (const [name, table] of Object.entries(tables)) {
  lines.push("");
  lines.push(`pub static ${name}: [Entry; ${table.length}] = [`);
  for (const [key, value] of table) lines.push(`    ("${key}", ${value}),`);
  lines.push("];");
}
const array = (name: string, type: string, doc: string, values: number[]) => {
  lines.push("");
  lines.push(`/// ${doc}`);
  lines.push(`pub static ${name}: [${type}; ${values.length}] = [`);
  for (let i = 0; i < values.length; i += 12) lines.push("    " + values.slice(i, i + 12).join(", ") + ",");
  lines.push("];");
};
array(
  "DARWIN_ERRNO_OF_LINUX",
  "u16",
  "By the number of an error on Linux: the number of macOS for the same name, 0 where macOS has none.",
  darwinOfLinux,
);
array(
  "UV_ERRNO_OF_LINUX",
  "i16",
  "By the number of an error on Linux: what libuv calls it on Windows (`UV_E*`), 0 where libuv has none.",
  uvOfLinux,
);
array(
  "DARWIN_SIGNAL_OF_LINUX",
  "u8",
  "By the number of a signal on Linux: the number of macOS for the same name, 0 where macOS has none.",
  darwinSignalOfLinux,
);
array(
  "WINDOWS_SIGNAL_OF_LINUX",
  "u8",
  "By the number of a signal on Linux: the number of Windows for the same name, 0 where Windows has none.",
  windowsSignalOfLinux,
);
lines.push("");

const out = join(root, "src/errno/host_tables.rs");
writeFileSync(out, lines.join("\n"));
console.log(
  `${out}: ${Object.entries(tables)
    .map(([k, t]) => `${k} ${t.length}`)
    .join(", ")}`,
);
console.log(
  `errors of Linux: ${linuxErrno.size - 1}, with a number on macOS: ${darwinOfLinux.filter(n => n !== 0).length}, with a UV_E* on Windows: ${uvOfLinux.filter(n => n !== 0).length}`,
);
