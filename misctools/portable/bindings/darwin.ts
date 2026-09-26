// The structures, the constants and the functions of macOS that bun's code for macOS uses, for the
// portable image: src/darwin_sys/generated.rs, and the two programs that print what they are.
//
//   bun darwin.ts              writes
//     ../../../src/darwin_sys/generated.rs          the definitions, for the image
//     darwin_layout.c                               for cc on a Mac: prints the size, the alignment
//                                                   and the offsets of every structure and the value
//                                                   of every constant, as the headers have them
//     ../slice/src/darwin_layout_generated.rs       the same facts as the image has them:
//                                                   `bun_fs_slice.img --layout-darwin`
//     darwin.json                                   what was written, and where each definition is
//                                                   from
//   bun darwin.ts --check      fails if one of the files is not what this tool would write
//
// The image is compiled for Linux, and the `libc` crate has its definitions for macOS under a `cfg`
// that the image does not meet. So they are written out here, from the crate itself: rustdoc documents
// the crate for x86_64-apple-darwin and for aarch64-apple-darwin (libc-facts.ts), and that is the crate
// with the `cfg` applied and every constant evaluated. A type is written with the integer types it
// stands for (`mode_t` is `u16`). Where the two processors differ, both definitions are written, each
// under its `cfg(target_arch)`.
//
// Which names: the ones that the inventory found in bun's code for macOS (../inventory/macos.json),
// the families below that bun_darwin_sys translates, and what those need.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { type Facts, type Item, type TypeRef, explicit, libcVersion, load } from "./libc-facts.ts";

const here = dirname(import.meta.path);
const repo = resolve(here, "../../..");
const work = resolve(process.env.WORK ?? "/tmp/portable/n3");
const check = process.argv.includes("--check");

const mac = { x86_64: load("x86_64-apple-darwin", work), aarch64: load("aarch64-apple-darwin", work) };
const image = { x86_64: load("x86_64-unknown-linux-musl", work), aarch64: load("aarch64-unknown-linux-musl", work) };
const arches = ["x86_64", "aarch64"] as const;
type ArchName = (typeof arches)[number];

// ── the names ──

const inventoryPath = join(here, "../inventory/macos.json");
if (!existsSync(inventoryPath)) throw new Error(`${inventoryPath}: run ../inventory/macos.ts first`);
const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
const wanted = new Set<string>();
for (const place of inventory.k2.places) {
  for (const f of place.functions) if (f.from === "libc crate") wanted.add(f.name);
  for (const t of place.types) wanted.add(t.name);
  for (const c of place.constants) wanted.add(c.name);
}
/** Families that bun_darwin_sys translates between the numbers of the image and the ones of macOS, whole.
    Error numbers and signals are taken by what they are, below: a name alone does not say it. */
const families: RegExp[] = [
  /^O_[A-Z_]+$/,
  /^AT_[A-Z_]+$/,
  /^F_(DUPFD|DUPFD_CLOEXEC|GETFD|SETFD|GETFL|SETFL|GETPATH|GETPATH_NOFIRMLINK|NOCACHE|FULLFSYNC|BARRIERFSYNC|PREALLOCATE|RDADVISE|RDAHEAD|GETLK|SETLK|SETLKW|RDLCK|WRLCK|UNLCK|ALLOCATECONTIG|ALLOCATEALL|PEOFPOSMODE|VOLPOSMODE|OK)$/,
  /^FD_CLOEXEC$/,
  /^S_I[A-Z]+$/,
  /^DT_[A-Z]+$/,
  /^CLONE_(NOFOLLOW|NOOWNERCOPY|ACL)$/,
  /^COPYFILE_[A-Z_]+$/,
  /^RENAME_(SWAP|EXCL)$/,
  /^(SEEK_(SET|CUR|END|HOLE|DATA)|[RWX]_OK|PATH_MAX|MAXPATHLEN)$/,
  /^MSG_[A-Z_]+$/,
  /^POLL[A-Z]+$/,
];
/** What the crate itself and the slice call. */
const extra = [
  "__error", "stat", "fstat", "lstat", "fstatat", "statfs", "fstatfs", "fcntl", "open", "openat", "close", "read", "write", "pread", "pwrite", "renameatx_np",
  "clonefile", "clonefileat", "fclonefileat", "copyfile", "fcopyfile", "copyfile_state_t", "copyfile_flags_t", "faccessat", "realpath", "lchmod", "fchmod", "fstore_t",
  "getattrlist", "fgetattrlist", "attrlist", "timeval", "timespec", "flock", "dirent", "fsync", "ftruncate", "unlinkat", "mkdirat", "getpid", "dlopen", "dlsym", "dlclose",
  "pthread_threadid_np", "pthread_setname_np", "getentropy", "sysctlbyname", "mach_absolute_time", "mach_timebase_info", "mach_timebase_info_data_t", "proc_pidpath",
  "kqueue", "kevent64", "kevent64_s", "kevent", "os_unfair_lock", "os_unfair_lock_lock", "os_unfair_lock_unlock", "os_unfair_lock_trylock",
];
for (const name of extra) wanted.add(name);
const pick = (facts: Facts, name: string, want: "function" | "other") => {
  const list = facts.byName.get(name) ?? [];
  return want === "function" ? list.find(item => item.kind === "function") : list.find(item => item.kind !== "function" && item.kind !== "other");
};
/** A constant of the type `int` from `least` to `most`. */
const isNumber = (name: string, least: number, most: number) => {
  const item = pick(mac.aarch64, name, "other");
  return item?.kind === "constant" && item.type?.kind === "named" && item.type.name === "c_int" && Number(item.number) >= least && Number(item.number) <= most;
};
// ELAST is the greatest error number, not an error. ECHO, EXTA and EXTPROC are settings of a terminal,
// ERA is an item of the locale, EMPTY and SIGNATURE are of the records of logins: none of them is here.
const isErrno = (name: string) => /^E[A-Z0-9]+$/.test(name) && name !== "ELAST" && isNumber(name, 1, 106);
const isSignal = (name: string) => /^SIG[A-Z0-9]+$/.test(name) && isNumber(name, 1, 31);
for (const facts of [mac.aarch64, mac.x86_64]) for (const name of facts.byName.keys()) if (families.some(family => family.test(name)) || isErrno(name) || isSignal(name)) wanted.add(name);
/** Names of the inventory that are no definitions of the crate for macOS, or that are written by hand. */
const notGenerated = new Set(["as", "c_char", "c_int", "c_uint", "c_void", "c_long", "c_ulong", "c_short", "c_ushort", "c_longlong", "c_ulonglong", "c_schar", "c_uchar", "c_float", "c_double"]);

/** Functions of libSystem with a variable number of arguments: never bound. The host has a function with fixed ones. */
const shims: Record<string, { symbol: string; arguments: string[] }> = {
  open: { symbol: "bun_host_darwin_open3", arguments: ["path: *const c_char", "oflag: c_int", "mode: c_int"] },
  openat: { symbol: "bun_host_darwin_openat4", arguments: ["dirfd: c_int", "path: *const c_char", "oflag: c_int", "mode: c_int"] },
  fcntl: { symbol: "bun_host_darwin_fcntl3", arguments: ["fd: c_int", "cmd: c_int", "argument: isize"] },
  ioctl: { symbol: "bun_host_darwin_ioctl3", arguments: ["fd: c_int", "request: c_ulong", "argument: isize"] },
};
/** Functions whose result is an error number. */
const returnsErrno = /^(pthread_(?!self|threadid_np)\w+|posix_spawn\w*|sigwait)$/;
/** A parameter that carries a number of a family that shared code and code for macOS both use: a directory
    descriptor (AT_FDCWD), the flags of open, the flags of the functions that end in `at`. The function is
    not handed to the code for macOS as it is: src/darwin_sys/libc.rs has one of the same name that translates. */
const crossing = /^(dirfd|dir_fd|fromfd|tofd|src_dirfd|dst_dirfd|olddirfd|newdirfd|oflag)$/;
const translatedByHand = new Set(["open", "openat", "fcntl", "fstatat", "faccessat", "unlinkat", "mkdirat", "renameatx_np", "clonefileat", "fclonefileat", "posix_spawn_file_actions_addopen", "__error"]);
/** Families whose numbers cross between shared code and code for macOS: code for macOS has the numbers of
    the image for them, and the functions above translate. */
const crossingConstants = /^(E[A-Z0-9]+|O_[A-Z_]+|AT_[A-Z_]+|F_(DUPFD_CLOEXEC|GETLK|SETLK|SETLKW|GETOWN|SETOWN|RDLCK|WRLCK|UNLCK))$/;
/** Functions that never set the error number of the C library. */
const noErrno = /^(os_unfair_lock_\w+|mach_\w+|host_\w+|vm_\w+|pthread_\w+|posix_spawn\w*|memset_pattern\d+|strlen|_NSGetEnviron|_dyld_\w+|__error|getpid|getppid|dlsym|dlopen|dlclose|sigemptyset|sigfillset|sigaddset|sigdelset|sigwait)$/;

// ── which definitions, and what they need ──

type Chosen = { name: string; kind: Item["kind"]; perArch: Record<ArchName, Item | undefined> };
const chosen = new Map<string, Chosen>();
const key = (name: string, want: "function" | "other") => `${want === "function" ? "fn" : "item"} ${name}`;
function choose(name: string, want: "function" | "other") {
  if (notGenerated.has(name) || chosen.has(key(name, want))) return;
  const perArch = { x86_64: pick(mac.x86_64, name, want), aarch64: pick(mac.aarch64, name, want) };
  const item = perArch.aarch64 ?? perArch.x86_64;
  if (!item) return;
  chosen.set(key(name, want), { name, kind: item.kind, perArch });
  for (const arch of arches) {
    const one = perArch[arch];
    if (!one) continue;
    const types: TypeRef[] = [];
    if (one.type) types.push(one.type);
    for (const field of one.fields ?? []) types.push(field.type);
    for (const input of one.inputs ?? []) types.push(input.type);
    if (one.output) types.push(one.output);
    for (const type of types) for (const named of namesOf(type)) choose(named, "other");
  }
}
function namesOf(type: TypeRef, out: string[] = []): string[] {
  switch (type.kind) {
    case "named":
      out.push(type.name);
      break;
    case "pointer":
      namesOf(type.to, out);
      break;
    case "array":
      namesOf(type.of, out);
      break;
    case "option":
      namesOf(type.of, out);
      break;
    case "function":
      for (const input of type.inputs) namesOf(input, out);
      if (type.output) namesOf(type.output, out);
      break;
    case "tuple":
      for (const t of type.of) namesOf(t, out);
      break;
  }
  return out;
}
for (const name of [...wanted].sort()) {
  choose(name, "other");
  choose(name, "function");
}

// ── Rust ──

// `char` is signed on macOS. It stays `c_char` here, which is unsigned in the image for arm64: what the
// image hands over is a pointer to it, or an array of it, and the code of the image has its own `c_char`
// in those. An argument that is a `char` itself is written `i8`.
const primitive: Record<string, string> = {
  c_void: "c_void", c_char: "c_char", c_schar: "i8", c_uchar: "u8", c_short: "i16", c_ushort: "u16", c_int: "i32", c_uint: "u32",
  c_long: "i64", c_ulong: "u64", c_longlong: "i64", c_ulonglong: "u64", c_float: "f32", c_double: "f64",
};
/** The type in Rust. A name of the crate that is a structure stays a name; everything else is written out. */
function rustOf(facts: Facts, type: TypeRef): string {
  const t = explicit(facts, type);
  const write = (t: TypeRef): string => {
    switch (t.kind) {
      case "primitive":
        return t.name === "never" ? "!" : t.name;
      case "named":
        return primitive[t.name] ?? t.name;
      case "pointer":
        return `*${t.mutable ? "mut" : "const"} ${write(t.to)}`;
      case "array":
        return `[${write(t.of)}; ${t.length}]`;
      case "option":
        return `Option<${write(t.of)}>`;
      case "function":
        return `unsafe extern "C" fn(${t.inputs.map(write).join(", ")}${t.variadic ? ", ..." : ""})${t.output ? ` -> ${write(t.output)}` : ""}`;
      case "tuple":
        return `(${t.of.map(write).join(", ")})`;
      case "other":
        return t.text;
    }
  };
  return write(t);
}
const definition = (facts: Facts, item: Item): string => {
  switch (item.kind) {
    case "type_alias":
      return `pub type ${item.name} = ${rustOf(facts, item.type!)};`;
    case "constant": {
      const type = rustOf(facts, item.type!);
      if (item.number === undefined) return "";
      return `pub const ${item.name}: ${type} = ${item.number};`;
    }
    case "struct":
    case "union": {
      const repr = ["C", ...(item.packed ? [`packed(${item.packed})`] : []), ...(item.align ? [`align(${item.align})`] : [])].join(", ");
      const fields = (item.fields ?? []).map(field => `    ${field.public ? "pub " : ""}${/^(type|ref|box|loop|move|in)$/.test(field.name) ? "r#" + field.name : field.name}: ${rustOf(facts, field.type)},`);
      return `#[repr(${repr})]\n#[derive(Clone, Copy)]\npub ${item.kind} ${item.name} {\n${fields.join("\n")}\n}`;
    }
    default:
      return "";
  }
};
const declaration = (facts: Facts, item: Item): string => {
  const shim = shims[item.name];
  const byValue = (type: string) => (type === "c_char" ? "i8" : type);
  const inputs = shim ? shim.arguments.map(a => a.replace(/c_int/g, "i32").replace(/c_ulong/g, "u64")) : (item.inputs ?? []).map((input, index) => `${/^(_|type|ref|box|loop|move|in|fn)?$/.test(input.name) ? `argument_${index}` : input.name}: ${byValue(rustOf(facts, input.type))}`);
  const symbol = shim ? shim.symbol : item.symbol;
  const lines: string[] = [];
  if (symbol) lines.push(`        #[link_name = "${symbol}"]`);
  if (noErrno.test(item.name)) lines.push(`        #[cfg_attr(bun_portable, no_errno)]`);
  lines.push(`        pub fn ${item.name}(${inputs.join(", ")})${item.output ? ` -> ${rustOf(facts, item.output)}` : ""};`);
  return lines.join("\n");
};

/** The same definition for both processors once, else each under its `cfg`. */
function perArch(entry: Chosen, write: (facts: Facts, item: Item) => string, indent = ""): string {
  const x = entry.perArch.x86_64 ? write(mac.x86_64, entry.perArch.x86_64) : "";
  const a = entry.perArch.aarch64 ? write(mac.aarch64, entry.perArch.aarch64) : "";
  if (x === a) return x;
  const out: string[] = [];
  if (x) out.push(`${indent}#[cfg(target_arch = "x86_64")]\n${x}`);
  if (a) out.push(`${indent}#[cfg(target_arch = "aarch64")]\n${a}`);
  return out.join("\n");
}

/** A structure that the image's own C library lays out the same way, field by field: the type of the
    image stands for it, so a value of shared code is a value of the code for macOS. */
function sameInImage(entry: Chosen): boolean {
  if (entry.kind !== "struct") return false;
  for (const arch of arches) {
    const ours = entry.perArch[arch];
    const theirs = pick(image[arch], entry.name, "other");
    if (!ours || !theirs || theirs.kind !== "struct" || ours.packed !== theirs.packed || ours.align !== theirs.align) return false;
    const a = (ours.fields ?? []).map(field => `${field.name}: ${rustOf(mac[arch], field.type)}`).join(";");
    const b = (theirs.fields ?? []).map(field => `${field.name}: ${rustOf(image[arch], field.type)}`).join(";");
    if (a !== b || (ours.fields ?? []).some(field => !field.public)) return false;
  }
  return true;
}

const all = [...chosen.values()].sort((a, b) => a.name.localeCompare(b.name));
const types = all.filter(entry => ["type_alias", "struct", "union"].includes(entry.kind));
const constants = all.filter(entry => entry.kind === "constant" && (entry.perArch.aarch64 ?? entry.perArch.x86_64)!.number !== undefined);
const functions = all.filter(entry => entry.kind === "function");
const variadic = functions.filter(entry => (entry.perArch.aarch64 ?? entry.perArch.x86_64)!.variadic);
const unbound = variadic.filter(entry => !shims[entry.name]).map(entry => entry.name);
const shared = new Set(types.filter(sameInImage).map(entry => entry.name));

// errno: the number of the image for every name of macOS.
const onlyMacos: Record<string, string> = JSON.parse(readFileSync(join(here, "darwin-errno.json"), "utf8")).in_the_image;
// The table is asked first: the libc crate has ENOATTR for Linux too, as a second name of ENODATA that
// the headers of Linux do not have, and the name of 61 on the way back is ENODATA.
const imageErrno = (name: string): { value: string; from: string } => {
  const other = onlyMacos[name];
  const same = pick(image.x86_64, name, "other");
  if (!other && same?.number !== undefined) return { value: `::libc::${name}`, from: "the same name" };
  if (!other) throw new Error(`darwin-errno.json has no number of the image for ${name}`);
  return /^\d+$/.test(other) ? { value: other, from: "a number that bun has and Linux has not" } : { value: `::libc::${other}`, from: `no such name in the image: ${other}` };
};

// Flags that macOS has and Linux has not get bits that no flag of Linux uses, on either processor.
const freeBits = [0x0100_0000, 0x0200_0000, 0x0400_0000, 0x0800_0000, 0x1000_0000, 0x2000_0000];
const extension = new Map<string, number>();
function inTheImage(entry: Chosen): { value: string; why: string } {
  const name = entry.name;
  const item = (entry.perArch.aarch64 ?? entry.perArch.x86_64)!;
  if (isErrno(name)) return { value: imageErrno(name).value, why: imageErrno(name).from };
  const same = pick(image.x86_64, name, "other");
  if (same?.number !== undefined) return { value: `::libc::${name}`, why: "the same name" };
  if (item.number === "0") return { value: "0", why: "0 on macOS" };
  const family = name.split("_")[0];
  const used = [...extension].filter(([other]) => other.split("_")[0] === family).length;
  if (!extension.has(name)) {
    if (used >= freeBits.length) throw new Error(`no bit left for ${name}`);
    extension.set(name, freeBits[used]);
  }
  return { value: `0x${extension.get(name)!.toString(16)}`, why: "macOS only: a bit that no flag of Linux has" };
}

// A name that the image has too comes first: it is the name of its number on the way back.
const errnoNames = constants.filter(entry => isErrno(entry.name)).sort((a, b) => Number(imageErrno(a.name).from !== "the same name") - Number(imageErrno(b.name).from !== "the same name") || a.name.localeCompare(b.name));

const sources = new Set<string>();
for (const entry of all) for (const arch of arches) if (entry.perArch[arch]) sources.add(entry.perArch[arch]!.file);

const header = `// Written by misctools/portable/bindings/darwin.ts. Do not edit.
//
// Definitions of macOS for the portable image, from the \`libc\` crate ${libcVersion()} as rustdoc documents it
// for x86_64-apple-darwin and aarch64-apple-darwin. The files of the crate they are in:
${[...sources].sort().map(file => `//   ${file}`).join("\n")}
// misctools/portable/bindings/darwin.json names the file of each one.
#![allow(deprecated)]
`;

const rustLines: string[] = [header];
rustLines.push(`/// Types. An integer type of C is written as the integer it is on macOS.
pub mod types {
    use core::ffi::{c_char, c_void};
`);
for (const entry of types) {
  if (shared.has(entry.name)) rustLines.push(`    pub use ::libc::${entry.name};`);
  else rustLines.push(perArch(entry, definition, "    ").split("\n").map(line => (line.startsWith("    #[cfg") ? line : "    " + line)).join("\n"));
}
rustLines.push(`}

/// Constants, with the values of macOS.
pub mod constants {
`);
for (const entry of constants) rustLines.push(perArch(entry, definition, "    ").split("\n").map(line => (line.startsWith("    #[cfg") ? line : "    " + line)).join("\n"));
rustLines.push(`}

/// The functions, bound through the import table.
pub mod functions {
    use super::types::*;
    use core::ffi::{c_char, c_void};

    #[bun_portable_macros::imports(library = "libSystem", host = "macos")]
    unsafe extern "C" {`);
for (const entry of functions) {
  if (unbound.includes(entry.name)) continue;
  rustLines.push(perArch(entry, declaration, "        "));
}
rustLines.push(`    }
}

/// The functions as the code for macOS gets them. One whose result is an error number gives the number
/// of the image. One that takes a directory descriptor or flags of a family that shared code uses too is
/// not here: \`bun_darwin_sys::libc\` has it, and translates.
pub(crate) mod functions_for_bun {
    #[allow(unused_imports)]
    use super::types::*;
    #[allow(unused_imports)]
    use core::ffi::{c_char, c_void};
`);
for (const entry of functions) {
  if (unbound.includes(entry.name)) continue;
  const item = (entry.perArch.aarch64 ?? entry.perArch.x86_64)!;
  const crosses = (item.inputs ?? []).some(input => crossing.test(input.name)) || !!shims[entry.name];
  if (crosses) {
    if (!translatedByHand.has(entry.name)) throw new Error(`${entry.name} takes a number that crosses (${(item.inputs ?? []).map(i => i.name).join(", ")}): write its function in src/darwin_sys/libc.rs and name it in translatedByHand`);
    continue;
  }
  if (translatedByHand.has(entry.name)) continue;
  if (!returnsErrno.test(entry.name)) {
    rustLines.push(`    pub use super::functions::${entry.name};`);
    continue;
  }
  rustLines.push(
    perArch(
      entry,
      (facts, one) => {
        const inputs = (one.inputs ?? []).map((input, index) => ({ name: /^(_|type|ref|box|loop|move|in|fn)?$/.test(input.name) ? `argument_${index}` : input.name, type: rustOf(facts, input.type) }));
        return `    /// The result is an error number: the one of the image.\n    #[inline]\n    pub unsafe fn ${one.name}(${inputs.map(i => `${i.name}: ${i.type}`).join(", ")}) -> i32 {\n        crate::errno::to_image(unsafe { super::functions::${one.name}(${inputs.map(i => i.name).join(", ")}) })\n    }`;
      },
      "    ",
    ),
  );
}
rustLines.push(`}

/// The constants as the code for macOS gets them: the values of macOS, and for the families that
/// shared code uses too (error numbers, the flags of open, the flags of the functions that end in
/// \`at\`) the values of the image, which \`bun_darwin_sys::translate\` turns into the ones of macOS.
pub(crate) mod constants_for_bun {`);
const crossingList: { name: string; macos: string; in_the_image: string; why: string }[] = [];
for (const entry of constants) {
  const item = (entry.perArch.aarch64 ?? entry.perArch.x86_64)!;
  if (!crossingConstants.test(entry.name) || (/^E[A-Z0-9]+$/.test(entry.name) && !isErrno(entry.name))) {
    rustLines.push(`    pub use super::constants::${entry.name};`);
    continue;
  }
  const found = inTheImage(entry);
  crossingList.push({ name: entry.name, macos: item.number!, in_the_image: found.value.replace("::libc::", ""), why: found.why });
  rustLines.push(`    pub const ${entry.name}: ${rustOf(mac.aarch64, item.type!)} = ${found.value} as ${rustOf(mac.aarch64, item.type!)};`);
}
rustLines.push(`}

/// The flags of open and of the functions that end in \`at\`: (the flag of the image, the flag of macOS).
pub(crate) mod flag_pairs {
    pub(crate) const OPEN: &[(i32, i32)] = &[`);
for (const entry of constants.filter(entry => /^O_[A-Z_]+$/.test(entry.name) && !/^O_(ACCMODE|RDONLY|WRONLY|RDWR|EXEC|SEARCH)$/.test(entry.name) && (entry.perArch.aarch64 ?? entry.perArch.x86_64)!.number !== "0"))
  rustLines.push(`        (super::constants_for_bun::${entry.name}, super::constants::${entry.name}),`);
rustLines.push(`    ];
    pub(crate) const AT: &[(i32, i32)] = &[`);
for (const entry of constants.filter(entry => /^AT_[A-Z_]+$/.test(entry.name) && entry.name !== "AT_FDCWD")) rustLines.push(`        (super::constants_for_bun::${entry.name}, super::constants::${entry.name}),`);
rustLines.push(`    ];
}

/// The error numbers of macOS by their names, each with its number in the image: the number of the same
/// name there, or of the name that stands for it (misctools/portable/bindings/darwin-errno.json).
pub(crate) mod errno_names {
    pub(crate) const IN_THE_IMAGE: &[(i32, i32)] = &[`);
for (const entry of errnoNames) rustLines.push(`        (super::constants::${entry.name}, ${imageErrno(entry.name).value} as i32),`);
rustLines.push(`    ];
}
`);
const rustText = rustLines.join("\n");

// ── the two programs ──

type CType = { c: string; header: string; fields?: Record<string, string>; skip?: string[] };
/** Where the headers spell a type or a field in another way than the crate. */
const cTypes: Record<string, Partial<CType>> = {
  stat: {
    header: "sys/stat.h",
    fields: {
      st_atime: "st_atimespec.tv_sec", st_atime_nsec: "st_atimespec.tv_nsec", st_mtime: "st_mtimespec.tv_sec", st_mtime_nsec: "st_mtimespec.tv_nsec",
      st_ctime: "st_ctimespec.tv_sec", st_ctime_nsec: "st_ctimespec.tv_nsec", st_birthtime: "st_birthtimespec.tv_sec", st_birthtime_nsec: "st_birthtimespec.tv_nsec",
    },
  },
  statfs: { header: "sys/mount.h" },
  dirent: { header: "sys/dirent.h" },
  sockaddr_dl: { header: "net/if_dl.h" },
  kevent: { header: "sys/event.h" },
  kevent64_s: { header: "sys/event.h" },
  attrlist: { header: "sys/attr.h" },
  vm_statistics64: { header: "mach/mach.h" },
  processor_cpu_load_info: { header: "mach/mach.h" },
  mach_timebase_info: { header: "mach/mach_time.h" },
  os_unfair_lock_s: { header: "os/lock.h" },
  fstore_t: { c: "fstore_t", header: "fcntl.h" },
  fsid_t: { c: "fsid_t", header: "sys/mount.h" },
  sigset_t: { c: "sigset_t", header: "signal.h" },
};
const headers = [
  "sys/types.h", "sys/stat.h", "sys/mount.h", "sys/dirent.h", "sys/event.h", "sys/attr.h", "sys/clonefile.h", "sys/socket.h", "sys/time.h", "sys/uio.h", "sys/wait.h",
  "sys/sysctl.h", "sys/param.h", "net/if_dl.h", "copyfile.h", "errno.h", "fcntl.h", "poll.h", "signal.h", "spawn.h", "stdio.h", "unistd.h", "pthread.h", "os/lock.h",
  "mach/mach.h", "mach/mach_time.h", "libproc.h", "dlfcn.h",
];
const typeFacts = types
  .filter(entry => entry.kind !== "type_alias" || true)
  .map(entry => {
    const item = (entry.perArch.aarch64 ?? entry.perArch.x86_64)!;
    const known = cTypes[entry.name] ?? {};
    const c = known.c ?? (item.kind === "struct" ? `struct ${entry.name}` : item.kind === "union" ? `union ${entry.name}` : entry.name);
    return { entry, item, c, fields: (item.fields ?? []).filter(field => field.public && !/^_|^__/.test(field.name) && !(known.skip ?? []).includes(field.name)).map(field => ({ rust: field.name, c: known.fields?.[field.name] ?? field.name })) };
  });

const parts: string[] = [];
const partOf: { part: number; what: string }[] = [];
let part = 0;
for (const fact of typeFacts) {
  part++;
  partOf.push({ part, what: `type ${fact.entry.name}` });
  const lines = [`#if PART == ${part}`, `  printf("{\\"fact\\":\\"size\\",\\"of\\":\\"${fact.entry.name}\\",\\"value\\":%zu}\\n", sizeof(${fact.c}));`, `  printf("{\\"fact\\":\\"align\\",\\"of\\":\\"${fact.entry.name}\\",\\"value\\":%zu}\\n", _Alignof(${fact.c}));`];
  for (const field of fact.fields) {
    // A field that the headers of a Mac do not have is left out by its macro, and the rest of the type is checked.
    lines.push(`#ifndef SKIP_${fact.entry.name}_${field.c.split(".")[0]}`);
    lines.push(`  printf("{\\"fact\\":\\"offset\\",\\"of\\":\\"${fact.entry.name}.${field.rust}\\",\\"value\\":%zu}\\n", offsetof(${fact.c}, ${field.c}));`);
    lines.push(`  printf("{\\"fact\\":\\"field size\\",\\"of\\":\\"${fact.entry.name}.${field.rust}\\",\\"value\\":%zu}\\n", sizeof(((${fact.c} *)0)->${field.c}));`);
    lines.push(`#endif`);
  }
  lines.push(`#endif`);
  parts.push(lines.join("\n"));
}
// Constants: each one alone, so that a name that the headers do not have is one line of the report.
const constantsPart = ++part;
partOf.push({ part: constantsPart, what: "the constants" });
const constantLines = [`#if PART == ${constantsPart}`];
for (const entry of constants) {
  constantLines.push(`#ifdef ${entry.name}`);
  constantLines.push(`  printf("{\\"fact\\":\\"constant\\",\\"of\\":\\"${entry.name}\\",\\"value\\":%lld}\\n", (long long)(${entry.name}));`);
  constantLines.push(`#else`);
  constantLines.push(`  printf("{\\"fact\\":\\"constant\\",\\"of\\":\\"${entry.name}\\",\\"value\\":\\"no macro of this name\\"}\\n");`);
  constantLines.push(`#endif`);
}
constantLines.push(`#endif`);
parts.push(constantLines.join("\n"));

const cText = `// Written by misctools/portable/bindings/darwin.ts. Do not edit.
//
// Prints what the headers of macOS say about the structures and the constants of bun_darwin_sys, one
// JSON object on each line: {"fact": "size" | "align" | "offset" | "field size" | "constant", "of", "value"}.
// \`bun_fs_slice.img --layout-darwin\` prints the same lines from the image, in the same order.
//
// The program has ${part} parts, one for each structure and one for the constants, and is compiled once for
// each: a name that the headers of this macOS do not have stops one part and not the others.
//   cc -DPART=<n> -o part darwin_layout.c && ./part        n = 1 .. ${part}
//   cc -DPART=0 ...                                         prints the number of parts
// A field that the headers do not have is left out with -DSKIP_<type>_<field>, which run-on-mac.sh
// does from the message of the compiler.
${headers.map(name => `#include <${name}>`).join("\n")}
#include <stddef.h>

int main(void) {
#if PART == 0
  printf("${part}\\n");
#endif
${parts.join("\n")}
  return 0;
}
`;

const imageLines: string[] = [
  `// Written by misctools/portable/bindings/darwin.ts. Do not edit.
//
// The size, the alignment and the offsets of every structure of bun_darwin_sys and the value of every
// constant, as this program has them: the lines that misctools/portable/bindings/darwin_layout.c prints
// from the headers of macOS.
#![allow(clippy::all, deprecated, non_snake_case)]

use core::mem::{align_of, offset_of, size_of};
use std::io::Write as _;

use bun_darwin_sys::{constants, types};

fn size_of_field<T, F>(_: fn(&T) -> &F) -> usize {
    size_of::<F>()
}

pub fn facts(out: &mut Vec<u8>) {`,
];
for (const fact of typeFacts) {
  imageLines.push(`    {`);
  imageLines.push(`        type T = types::${fact.entry.name};`);
  imageLines.push(`        let _ = writeln!(out, "{{\\"fact\\":\\"size\\",\\"of\\":\\"${fact.entry.name}\\",\\"value\\":{}}}", size_of::<T>());`);
  imageLines.push(`        let _ = writeln!(out, "{{\\"fact\\":\\"align\\",\\"of\\":\\"${fact.entry.name}\\",\\"value\\":{}}}", align_of::<T>());`);
  for (const field of fact.fields) {
    const name = /^(type|ref|box|loop|move|in)$/.test(field.rust) ? "r#" + field.rust : field.rust;
    const place = fact.item.kind === "union" ? `unsafe { &value.${name} }` : `&value.${name}`;
    imageLines.push(`        let _ = writeln!(out, "{{\\"fact\\":\\"offset\\",\\"of\\":\\"${fact.entry.name}.${field.rust}\\",\\"value\\":{}}}", offset_of!(T, ${name}));`);
    if (fact.item.packed) imageLines.push(`        let _ = writeln!(out, "{{\\"fact\\":\\"field size\\",\\"of\\":\\"${fact.entry.name}.${field.rust}\\",\\"value\\":{}}}", { let value: T = unsafe { core::mem::zeroed() }; let field = value.${name}; size_of_val(&field) });`);
    else imageLines.push(`        let _ = writeln!(out, "{{\\"fact\\":\\"field size\\",\\"of\\":\\"${fact.entry.name}.${field.rust}\\",\\"value\\":{}}}", size_of_field(|value: &T| ${place}));`);
  }
  imageLines.push(`    }`);
}
for (const entry of constants) imageLines.push(`    let _ = writeln!(out, "{{\\"fact\\":\\"constant\\",\\"of\\":\\"${entry.name}\\",\\"value\\":{}}}", constants::${entry.name} as i64);`);
imageLines.push(`}
`);
const imageText = imageLines.join("\n");

const facts = {
  about: "What misctools/portable/bindings/darwin.ts wrote into src/darwin_sys/generated.rs, and where each definition is in the libc crate.",
  libc_crate: libcVersion(),
  targets: [mac.x86_64.target, mac.aarch64.target],
  types: types.map(entry => ({ name: entry.name, kind: entry.kind, file: (entry.perArch.aarch64 ?? entry.perArch.x86_64)!.file, the_type_of_the_image: shared.has(entry.name) || undefined, differs_by_processor: perArch(entry, definition).includes("#[cfg(target_arch") || undefined })),
  constants: constants.map(entry => ({ name: entry.name, value: (entry.perArch.aarch64 ?? entry.perArch.x86_64)!.number, x86_64: entry.perArch.x86_64?.number !== entry.perArch.aarch64?.number ? entry.perArch.x86_64?.number : undefined, file: (entry.perArch.aarch64 ?? entry.perArch.x86_64)!.file })),
  functions: functions
    .filter(entry => !unbound.includes(entry.name))
    .map(entry => {
      const item = (entry.perArch.aarch64 ?? entry.perArch.x86_64)!;
      return { name: entry.name, symbol: shims[entry.name]?.symbol ?? item.symbol, symbol_x86_64: entry.perArch.x86_64?.symbol !== item.symbol ? entry.perArch.x86_64?.symbol : undefined, variadic_in_libSystem: item.variadic || undefined, arguments: (item.inputs ?? []).length, sets_errno: !noErrno.test(entry.name), file: item.file };
    }),
  variadic_without_a_function_of_the_host: unbound,
  shims: Object.values(shims).map(shim => shim.symbol),
  in_the_numbers_of_the_image: crossingList,
  translated_by_hand: [...translatedByHand],
  errno: errnoNames.map(entry => ({ name: entry.name, macos: (entry.perArch.aarch64 ?? entry.perArch.x86_64)!.number, in_the_image: imageErrno(entry.name).value.replace("::libc::", ""), why: imageErrno(entry.name).from })),
  parts_of_darwin_layout_c: partOf,
};

const outputs: [string, string][] = [
  [join(repo, "src/darwin_sys/generated.rs"), rustText],
  [join(here, "darwin_layout.c"), cText],
  [join(here, "../slice/src/darwin_layout_generated.rs"), imageText],
  [join(here, "darwin.json"), JSON.stringify(facts, null, 1) + "\n"],
];
let stale = 0;
for (const [path, text] of outputs) {
  if (check) {
    if (!existsSync(path) || readFileSync(path, "utf8") !== text) {
      console.log(`NOT UP TO DATE ${path}`);
      stale++;
    }
  } else writeFileSync(path, text);
}
console.log(`${types.length} types (${shared.size} of them the types of the image), ${constants.length} constants, ${functions.length - unbound.length} functions (${Object.keys(shims).filter(name => functions.some(f => f.name === name)).length} through a function of the host), ${errnoNames.length} error numbers, ${part} parts of darwin_layout.c`);
if (unbound.length) console.log(`variadic and without a function of the host, so not bound: ${unbound.join(" ")}`);
process.exit(stale ? 1 : 0);
