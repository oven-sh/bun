// The layout of bun's bindings for Windows and for libuv, for a check against the headers.
//
// The portable image is compiled for Linux, where `long` has 64 bits and a structure is laid out by
// the rules of the System V ABI. What it passes to Windows has to have the layout that the compiler
// of Windows gives the C declaration. This tool reads the bindings and writes two programs that
// print the same facts, one from each side:
//
//   bun layout.ts        writes
//     windows_layout.c                       for clang on Windows, with the headers of the Windows SDK
//                                            and of libuv: see verify.ts, which compiles and runs it,
//                                            or, on a machine that compiles for Windows and cannot
//                                            run it, compiles it to a table and reads the table
//     ../slice/src/layout_generated.rs       the same for the image: `bun_fs_slice.img --layout`
//   bun layout.ts --list prints what it found, as JSON
//
// A fact is: the size and the alignment of a `#[repr(C)]` structure or union, the offset and the size
// of each of its fields, and the value of a constant that is an integer. compare.ts compares the two
// outputs.
//
// Where a binding is, on purpose, not the declaration of the header, this file says how the two are
// compared: `cTypeNames` (another name), `partialViews` (the first fields only), `unionFields` (one
// field for an anonymous union), `cTypes` (what C calls the type, a tag for one) and `cFields` (what
// the header calls a field that bun gave another name). A fact keeps the name of the binding.
//
// What is read: every `pub` structure, union and constant of the three binding files that the image
// has (an item under a `cfg` that the image does not meet is not in the image, and is left out).
// A field that is not `pub` cannot be named from the program of the image; its structure's size
// still covers it. A name that the headers do not have is found by the compiler on Windows:
// verify.ts leaves it out and reports it.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const here = dirname(import.meta.path);
const repo = resolve(here, "../../..");

const sources = [
  { file: "src/windows_sys/externs.rs", path: "bun_windows_sys" },
  { file: "src/libuv_sys/libuv.rs", path: "bun_libuv_sys" },
  { file: "src/sys/windows/mod.rs", path: "bun_sys::windows" },
];

/** Names that bun's bindings spell in another way than the header does. */
const cTypeNames: Record<string, string> = {
  "bun_libuv_sys::Handle": "uv_handle_t",
  "bun_libuv_sys::Loop": "uv_loop_t",
  "bun_libuv_sys::Pipe": "uv_pipe_t",
  "bun_libuv_sys::Timer": "uv_timer_t",
  "bun_libuv_sys::Process": "uv_process_t",
  "bun_libuv_sys::fs_t": "uv_fs_t",
  // wincontypes.h: the structure is WINDOW_BUFFER_SIZE_RECORD; WINDOW_BUFFER_SIZE_EVENT is the number
  // of the event, an `int` to `sizeof`.
  "bun_windows_sys::WINDOW_BUFFER_SIZE_EVENT": "WINDOW_BUFFER_SIZE_RECORD",
};
/** A binding that declares the fields bun reads and stops: its size and alignment are not the structure's. */
const partialViews = new Set(["bun_windows_sys::TEB", "bun_windows_sys::PEB"]);
/**
 * A field of a binding that stands for an anonymous union of the header, named as one member of it.
 * Its size is the union's: what lies between the member and the field after it.
 */
const unionFields: Record<string, { after: string }> = {
  // union { NTSTATUS Status; PVOID Pointer; }; ULONG_PTR Information;
  "bun_windows_sys::IO_STATUS_BLOCK.Status": { after: "Information" },
};
/** How C names a type that has no name of its own in the headers: its tag. */
const cTypes: Record<string, string> = {
  addrinfo: "struct addrinfo",
  sockaddr: "struct sockaddr",
  sockaddr_in: "struct sockaddr_in",
  sockaddr_in6: "struct sockaddr_in6",
  sockaddr_storage: "struct sockaddr_storage",
  in_addr: "struct in_addr",
  in6_addr: "struct in6_addr",
  uv__queue: "struct uv__queue",
  uv__work: "struct uv__work",
  uv_cpu_times_t: "struct uv_cpu_times_s",
};
/** The field of the header, for a field of a binding that has another name: `<type of C>.<field of the binding>`. */
const cFields: Record<string, string> = {
  "uv_timespec_t.sec": "tv_sec",
  "uv_timespec_t.nsec": "tv_nsec",
  "uv_timeval_t.sec": "tv_sec",
  "uv_timeval_t.usec": "tv_usec",
  "uv_stat_t.atim": "st_atim",
  "uv_stat_t.mtim": "st_mtim",
  "uv_stat_t.ctim": "st_ctim",
  "uv_stat_t.birthtim": "st_birthtim",
  "uv_timer_t.heap_node": "node.heap",
};
/** `loop` and `type` are keywords of Rust. */
const cFieldNames: Record<string, string> = { loop_: "loop", type_: "type" };

const integerTypes = new Set([
  "u8",
  "u16",
  "u32",
  "u64",
  "usize",
  "i8",
  "i16",
  "i32",
  "i64",
  "isize",
  "c_int",
  "c_uint",
  "c_short",
  "c_ushort",
  "c_char",
  "c_uchar",
  "c_longlong",
  "c_ulonglong",
]);
const unsignedTypes = new Set(["u8", "u16", "u32", "u64", "usize", "c_uint", "c_ushort", "c_uchar", "c_ulonglong"]);

export type Field = { name: string; cName: string; public: boolean; unionBefore?: string };
export type Type = {
  kind: "struct" | "union";
  rust: string;
  c: string;
  packed: boolean;
  partial: boolean;
  fields: Field[];
  file: string;
  line: number;
};
export type Constant = { rust: string; c: string; unsigned: boolean; file: string; line: number };

/** Whether the image (x86-64 or arm64, Linux target, `bun_portable`) has an item under this `cfg`. */
function inImage(condition: string): boolean | undefined {
  const text = condition.replace(/\s+/g, "");
  const known: Record<string, boolean> = {
    "windows": false,
    "not(windows)": true,
    "unix": true,
    "any(windows,bun_portable)": true,
    'target_pointer_width="64"': true,
    "debug_assertions": false,
    "bun_portable": true,
    "not(bun_portable)": false,
    'all(any(windows,bun_portable),target_pointer_width="64")': true,
  };
  if (text in known) return known[text];
  if (/^all\(windows,/.test(text)) return false;
  return undefined;
}

function scan(source: { file: string; path: string }) {
  const lines = readFileSync(join(repo, source.file), "utf8").split("\n");
  const types: Type[] = [];
  const constants: Constant[] = [];
  const aliases = new Map<string, string>();
  const skipped: { name: string; why: string; file: string; line: number }[] = [];
  // The modules that are open at a line, by their indentation.
  const modules: { indent: number; name: string }[] = [];

  const attributesAbove = (at: number) => {
    const out: string[] = [];
    for (let i = at - 1; i >= 0 && /^\s*(#\[|\/\/)/.test(lines[i]); i--) {
      const attribute = lines[i].trim();
      if (!attribute.startsWith("#[")) continue;
      // What the image has of an attribute that depends on it.
      const forImage = /^#\[cfg_attr\(bun_portable, (.*)\)\]$/.exec(attribute);
      if (forImage) out.push(`#[${forImage[1]}]`);
      else if (!/^#\[cfg_attr\(not\(bun_portable\),/.test(attribute)) out.push(attribute);
    }
    return out;
  };
  const excluded = (attributes: string[]) => {
    for (const attribute of attributes) {
      const condition = /^#\[cfg\((.*)\)\]$/.exec(attribute)?.[1];
      if (condition === undefined) continue;
      const has = inImage(condition);
      if (has !== true) return has === false ? `cfg(${condition})` : `cfg(${condition}), not decided by this tool`;
    }
    return undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indent = /^(\s*)/.exec(line)![1].length;
    while (modules.length && line.trim() === "}" && indent === modules[modules.length - 1].indent) modules.pop();
    const module = /^\s*pub(?:\(crate\))? mod ([A-Za-z_0-9]+) \{$/.exec(line);
    if (module) {
      modules.push({ indent, name: module[1] });
      continue;
    }
    // Only what is directly in a module: not the body of a function or of an `impl`.
    if (indent !== (modules.length ? modules[modules.length - 1].indent + 4 : 0)) continue;
    const path = [source.path, ...modules.map(m => m.name)].join("::");

    const alias = /^\s*pub(?:\(crate\))? type ([A-Za-z_0-9]+) = ([A-Za-z_0-9:]+);/.exec(line);
    if (alias) aliases.set(alias[1], alias[2].split("::").pop()!);

    const type = /^\s*pub (struct|union) ([A-Za-z_0-9]+) \{$/.exec(line);
    if (type) {
      const attributes = attributesAbove(i);
      const repr = attributes.find(a => a.startsWith("#[repr("));
      const why = excluded(attributes) ?? (repr?.includes("C") ? undefined : "not #[repr(C)]");
      const rust = `${path}::${type[2]}`;
      if (why) {
        skipped.push({ name: rust, why, file: source.file, line: i + 1 });
        continue;
      }
      const fields: Field[] = [];
      for (let k = i + 1; k < lines.length && lines[k].trim() !== "}"; k++) {
        const field = /^\s*(pub(?:\([a-z]+\))? )?([a-zA-Z_][A-Za-z_0-9]*): /.exec(lines[k]);
        if (!field || /^\s*(\/\/|#\[)/.test(lines[k])) continue;
        fields.push({
          name: field[2],
          cName: cFieldNames[field[2]] ?? field[2],
          public: field[1] === "pub ",
          unionBefore: unionFields[`${rust}.${field[2]}`]?.after,
        });
      }
      types.push({
        kind: type[1] as "struct" | "union",
        rust,
        c: cTypeNames[rust] ?? type[2],
        packed: repr!.includes("packed"),
        partial: partialViews.has(rust),
        fields,
        file: source.file,
        line: i + 1,
      });
      continue;
    }

    const constant = /^\s*pub const ([A-Za-z_0-9]+): ([A-Za-z_0-9:]+) =/.exec(line);
    if (constant) {
      const rust = `${path}::${constant[1]}`;
      const why = excluded(attributesAbove(i));
      if (why) {
        skipped.push({ name: rust, why, file: source.file, line: i + 1 });
        continue;
      }
      constants.push({
        rust,
        c: constant[1],
        unsigned: false,
        file: source.file,
        line: i + 1,
        ...{ type: constant[2].split("::").pop()! },
      } as Constant & { type: string });
    }
  }
  return { types, constants: constants as (Constant & { type: string })[], aliases, skipped };
}

export function collect() {
  const types: Type[] = [];
  const constants: Constant[] = [];
  const skipped: { name: string; why: string; file: string; line: number }[] = [];
  const aliases = new Map<string, string>();
  const scans = sources.map(scan);
  for (const s of scans) for (const [name, target] of s.aliases) aliases.set(name, target);
  const resolveType = (name: string) => {
    for (let i = 0; i < 8 && aliases.has(name); i++) name = aliases.get(name)!;
    return name;
  };
  const seen = new Set<string>();
  for (const s of scans) {
    skipped.push(...s.skipped);
    for (const type of s.types) {
      // Two bindings of one C type: the first one stands for both in the C program.
      if (seen.has(`type ${type.c}`)) {
        skipped.push({ name: type.rust, why: `a second binding of ${type.c}`, file: type.file, line: type.line });
        continue;
      }
      seen.add(`type ${type.c}`);
      types.push(type);
    }
    for (const constant of s.constants) {
      const base = resolveType(constant.type);
      if (!integerTypes.has(base)) {
        skipped.push({
          name: constant.rust,
          why: `${constant.type} is not an integer type`,
          file: constant.file,
          line: constant.line,
        });
        continue;
      }
      if (seen.has(`constant ${constant.c}`)) continue;
      seen.add(`constant ${constant.c}`);
      constants.push({
        rust: constant.rust,
        c: constant.c,
        unsigned: unsignedTypes.has(base),
        file: constant.file,
        line: constant.line,
      });
    }
  }
  return { types, constants, skipped };
}

function cProgram(types: Type[], constants: Constant[]): string {
  const out: string[] = [];
  // The longest names, with the byte that ends a string; the numbers of a fact start at a multiple of 8.
  const typeLength = Math.max(...types.map(type => type.c.length), ...constants.map(constant => constant.c.length)) + 1;
  const fieldLength = Math.max(...types.flatMap(type => type.fields.map(field => field.cName.length))) + 1;
  const padded = fieldLength + ((8 - ((1 + typeLength + fieldLength) % 8)) % 8);
  out.push(`// Written by misctools/portable/bindings/layout.ts from the bindings of bun. Do not edit.
//
// What the headers of the Windows SDK and of libuv say about the structures and the constants of
// bun's bindings: sizes, alignments, offsets, values. verify.ts compiles it, in one of two forms:
//   clang -I <libuv>/include -o windows_layout.exe windows_layout.c
//       a program that prints the facts as JSON, for a Windows machine
//   clang --target=x86_64-pc-windows-msvc -I <libuv>/include -DBUN_LAYOUT_TABLE -c windows_layout.c
//       the facts as a table in the object file, bun_layout_facts, for a machine that has the
//       headers and does not run programs for Windows. verify.ts --table reads the table.
// Each fact is behind an #ifndef SKIP_..: a name that the headers do not have is left out by
// defining its macro, which verify.ts does from the messages of the compiler.
//   .. -DBUN_LAYOUT_TABLE -DBUN_LAYOUT_KERNEL_HEADERS -D_AMD64_ -idirafter <km of the Windows Driver Kit>
//       the same table from the headers of the Driver Kit, which declare the structures of the NT API
//       (FILE_DIRECTORY_INFORMATION ..) that the headers of the SDK leave out. The two sets of headers
//       do not go into one file, and every fact that these do not have is left out.
#if defined(BUN_LAYOUT_KERNEL_HEADERS)
#include <ntifs.h>
#include <stddef.h>
#else
#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <winternl.h>
#include <psapi.h>
#endif
#include <stddef.h>
#include <stdio.h>
#include <uv.h>
#endif

// A fact has the name that the binding has. The macros are also given what the headers call the type
// and the field.
#ifdef BUN_LAYOUT_TABLE
#define BUN_LAYOUT_TYPE_LENGTH ${typeLength}
#define BUN_LAYOUT_FIELD_LENGTH ${padded}
struct bun_layout_fact {
  char kind;
  char type[BUN_LAYOUT_TYPE_LENGTH];
  char field[BUN_LAYOUT_FIELD_LENGTH];
  unsigned long long first, second;
};
#define FACTS_BEGIN const struct bun_layout_fact bun_layout_facts[] = {
#define TYPE_BEGIN(name, type) {'T', #name, "", sizeof(type), _Alignof(type)},
#define FIELD(name, type, member, field) {'F', #name, #member, offsetof(type, field), sizeof(((type *)0)->field)},
#define FIELD_OF_UNION(name, type, member, field, after) {'F', #name, #member, offsetof(type, field), offsetof(type, after) - offsetof(type, field)},
#define TYPE_END
#define CONSTANTS_BEGIN
#define CONSTANT_SIGNED(name) {'S', #name, "", (unsigned long long)(long long)(name), 0},
#define CONSTANT_UNSIGNED(name) {'U', #name, "", (unsigned long long)(name), 0},
#define FACTS_END {'E', "", "", sizeof(void *) * 8, 0}};
#else
static int first;
static void comma(void) {
  if (!first) printf(",");
  first = 0;
}
#define TYPE_BEGIN(name, type) comma(); printf("\\n\\"" #name "\\":{\\"size\\":%zu,\\"align\\":%zu,\\"fields\\":{", sizeof(type), _Alignof(type)); first = 1;
#define FIELD(name, type, member, field) comma(); printf("\\"" #member "\\":{\\"offset\\":%zu,\\"size\\":%zu}", offsetof(type, field), sizeof(((type *)0)->field));
/* A member of an anonymous union that the binding has as one field: the size is the union's. */
#define FIELD_OF_UNION(name, type, member, field, after) comma(); printf("\\"" #member "\\":{\\"offset\\":%zu,\\"size\\":%zu}", offsetof(type, field), offsetof(type, after) - offsetof(type, field));
#define TYPE_END printf("}}"); first = 0;
#define CONSTANT_SIGNED(name) comma(); printf("\\n\\"" #name "\\":\\"%lld\\"", (long long)(name));
#define CONSTANT_UNSIGNED(name) comma(); printf("\\n\\"" #name "\\":\\"%llu\\"", (unsigned long long)(name));
#define FACTS_BEGIN int main(void) { printf("{\\"source\\":\\"headers\\",\\"pointer_bits\\":%zu,\\"types\\":{", sizeof(void *) * 8); first = 1;
#define CONSTANTS_BEGIN printf("\\n},\\"constants\\":{"); first = 1;
#define FACTS_END printf("\\n}}\\n"); return 0; }
#endif

FACTS_BEGIN`);
  for (const type of types) {
    out.push(`#ifndef SKIP_TYPE_${type.c}`);
    const ofC = cTypes[type.c] ?? type.c;
    out.push(`  TYPE_BEGIN(${type.c}, ${ofC})`);
    for (const field of type.fields) {
      const fieldOfC = cFields[`${type.c}.${field.cName}`] ?? field.cName;
      out.push(`#ifndef SKIP_FIELD_${type.c}_${field.cName}`);
      out.push(
        field.unionBefore
          ? `  FIELD_OF_UNION(${type.c}, ${ofC}, ${field.cName}, ${fieldOfC}, ${field.unionBefore})`
          : `  FIELD(${type.c}, ${ofC}, ${field.cName}, ${fieldOfC})`,
      );
      out.push(`#endif`);
    }
    out.push(`  TYPE_END`);
    out.push(`#endif`);
  }
  out.push(`  CONSTANTS_BEGIN`);
  for (const constant of constants) {
    out.push(`#ifndef SKIP_CONSTANT_${constant.c}`);
    out.push(`  ${constant.unsigned ? "CONSTANT_UNSIGNED" : "CONSTANT_SIGNED"}(${constant.c})`);
    out.push(`#endif`);
  }
  out.push(`FACTS_END`);
  return out.join("\n") + "\n";
}

function rustProgram(types: Type[], constants: Constant[]): string {
  const out: string[] = [];
  out.push(`// Written by misctools/portable/bindings/layout.ts from the bindings of bun. Do not edit.
//
// The size and the alignment of every structure of the bindings, the offset and the size of each field
// and the value of each constant, as this program has them.
#![allow(clippy::all, deprecated, non_snake_case)]

use core::mem::{align_of, offset_of, size_of};
use std::io::Write as _;

use crate::json::Report;

fn size_of_field<T, F>(_: fn(&T) -> &F) -> usize {
    size_of::<F>()
}

pub fn types(report: &mut Report) {
    let mut out = Vec::new();`);
  types.forEach((type, index) => {
    out.push(`    {`);
    out.push(`        type T = ${type.rust};`);
    out.push(
      `        let _ = write!(out, "${index ? "," : ""}\\n\\"${type.c}\\":{{${type.partial ? '\\"partial\\":true,' : ""}\\"size\\":{},\\"align\\":{},\\"fields\\":{{", size_of::<T>(), align_of::<T>());`,
    );
    let first = true;
    for (const field of type.fields) {
      if (!field.public) continue;
      // SAFETY (of the generated line): the field of a union is borrowed, not read.
      const place = type.kind === "union" ? `unsafe { &value.${field.name} }` : `&value.${field.name}`;
      const size = type.packed ? `"null"` : `size_of_field(|value: &T| ${place})`;
      out.push(
        `        let _ = write!(out, "${first ? "" : ","}\\"${field.cName}\\":{{\\"offset\\":{},\\"size\\":{}}}", offset_of!(T, ${field.name}), ${size});`,
      );
      first = false;
    }
    out.push(`        out.extend_from_slice(b"}}");`);
    out.push(`    }`);
  });
  out.push(`    report.raw(&out);`);
  out.push(`}`);
  out.push(``);
  out.push(`pub fn constants(report: &mut Report) {`);
  out.push(`    let mut out = Vec::new();`);
  constants.forEach((constant, index) => {
    out.push(
      `    let _ = write!(out, "${index ? "," : ""}\\n\\"${constant.c}\\":\\"{}\\"", ${constant.rust} as ${constant.unsigned ? "u64" : "i64"});`,
    );
  });
  out.push(`    report.raw(&out);`);
  out.push(`}`);
  return out.join("\n") + "\n";
}

if (import.meta.main) {
  const found = collect();
  if (process.argv[2] === "--list") {
    console.log(JSON.stringify(found, null, 1));
  } else {
    writeFileSync(join(here, "windows_layout.c"), cProgram(found.types, found.constants));
    writeFileSync(join(here, "../slice/src/layout_generated.rs"), rustProgram(found.types, found.constants));
    writeFileSync(join(here, "windows_layout.left-out.json"), JSON.stringify(found.skipped, null, 1) + "\n");
    const fields = found.types.reduce((n, t) => n + t.fields.length, 0);
    const hidden = found.types.reduce((n, t) => n + t.fields.filter(f => !f.public).length, 0);
    console.log(
      `${found.types.length} structures and unions with ${fields} fields (${hidden} of them not pub), ${found.constants.length} constants; ${found.skipped.length} items left out (windows_layout.left-out.json)`,
    );
  }
}
