// Dawn's generated `webgpu.h` → `webgpu_sys.rs`, which src/webgpu_sys/lib.rs includes: the C API as Rust declarations.
//
//   generate-webgpu-sys.ts <webgpu.h> <webgpu_sys.rs>
//
// The header is written by a template (vendor/dawn/generator/templates/api.h), so every declaration has one of a few
// shapes, and one that has none of them is an error here. Names stay as they are in C.

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { writeIfNotChanged } from "./helpers.ts";

const scalars: Record<string, string> = {
  void: "c_void",
  char: "c_char",
  int: "c_int",
  float: "f32",
  double: "f64",
  size_t: "usize",
  uint8_t: "u8",
  uint16_t: "u16",
  uint32_t: "u32",
  uint64_t: "u64",
  int32_t: "i32",
  int64_t: "i64",
};

const limits: Record<string, string> = {
  UINT32_MAX: "u32::MAX",
  UINT64_MAX: "u64::MAX",
  SIZE_MAX: "usize::MAX",
  NAN: "f32::NAN",
};

interface Declarator {
  name: string;
  type: string;
}

/** `WGPU_NULLABLE WGPUBindGroupEntry const * entries` */
function parseDeclarator(text: string): Declarator {
  const words = text
    .replace(/\*/g, " * ")
    .split(/\s+/)
    .filter(word => word !== "" && word !== "WGPU_NULLABLE" && word !== "struct");
  const name = words.pop();
  assert(name && /^\w+$/.test(name), `no name in "${text}"`);
  return { name, type: rustType(words, text) };
}

/** The words of a C type. `const` stands after what it qualifies, or in front of the first word. */
function rustType(words: readonly string[], text: string): string {
  const [base, ...rest] = words[0] === "const" ? [words[1], "const", ...words.slice(2)] : words;
  assert(base && /^\w+$/.test(base) && base !== "const", `"${text}" does not start with a type`);
  let type = scalars[base] ?? base;
  let isConst = false;
  for (const word of rest) {
    if (word === "const") isConst = true;
    else {
      assert(word === "*", `"${word}" in "${text}"`);
      type = `*${isConst ? "const" : "mut"} ${type}`;
      isConst = false;
    }
  }
  return type;
}

function parseReturnType(text: string): string {
  const words = text
    .replace(/\*/g, " * ")
    .split(/\s+/)
    .filter(word => word !== "" && word !== "WGPU_NULLABLE");
  return words.length === 1 && words[0] === "void" ? "" : ` -> ${rustType(words, text)}`;
}

function parseParameters(text: string): string {
  if (text.trim() === "void" || text.trim() === "") return "";
  return text
    .split(",")
    .map(parseDeclarator)
    .map(({ name, type }) => `${identifier(name)}: ${type}`)
    .join(", ");
}

const keywords = new Set(["type", "ref", "move", "use", "in", "loop", "match", "mod", "fn", "final", "override"]);
const identifier = (name: string) => (keywords.has(name) ? `r#${name}` : /^\d/.test(name) ? `_${name}` : name);

interface Struct {
  name: string;
  fields: Declarator[];
}

const [, , headerPath, outputPath] = process.argv;
assert(headerPath && outputPath, "usage: generate-webgpu-sys.ts <webgpu.h> <webgpu_sys.rs>");
const header = readFileSync(headerPath, "utf8");

const out: string[] = [];
const handles = new Set<string>();
const callbacks = new Set<string>();
const enums = new Set<string>();
const bitmasks = new Set<string>();
const structs = new Map<string, Struct>();
/** `WGPU_BUFFER_DESCRIPTOR_INIT` → what is between the braces. */
const initializers = new Map<string, { struct: string; body: string }>();

// A continued line is one line, and the initializers name their fields in comments.
const lines = header
  .replace(/\\\n/g, " ")
  .replace(/\/\*\.(\w+)=\*\//g, ".$1=")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "")
  .split("\n");

for (let i = 0; i < lines.length; i++) {
  const line = lines[i]!.trim();
  let match: RegExpExecArray | null;
  if (line === "" || line === "}" || /^extern "C"/.test(line)) continue;

  if ((match = /^#define (WGPU_\w+_INIT) _wgpu_MAKE_INIT_STRUCT\((\w+), \{(.*)\}\)$/.exec(line))) {
    initializers.set(match[1]!, { struct: match[2]!, body: match[3]! });
  } else if ((match = /^#define (WGPU_\w+) \((\w+)(?:\((\d+)\))?\)$/.exec(line))) {
    const [, name, value, argument] = match;
    const rust = argument === undefined ? limits[value!] : value === "UINT32_C" ? `${argument}u32` : undefined;
    assert(rust, `${name} is ${value}`);
    out.push(`pub const ${name}: ${rust.endsWith("u32") ? "u32" : rust.split("::")[0]} = ${rust};`);
  } else if (line.startsWith("#")) {
    continue;
  } else if ((match = /^typedef struct (\w+)Impl\* \1 WGPU_OBJECT_ATTRIBUTE;$/.exec(line))) {
    handles.add(match[1]!);
    out.push(
      `#[repr(C)]\npub struct ${match[1]}Impl {\n    _opaque: [u8; 0],\n}\npub type ${match[1]} = *mut ${match[1]}Impl;`,
    );
  } else if (/^struct \w+;$/.test(line) || line.includes(" emscripten_webgpu_get_device(")) {
    // A forward declaration, and a function that only Emscripten's implementation defines.
    continue;
  } else if ((match = /^typedef (uint\d+_t) (\w+);$/.exec(line))) {
    out.push(`pub type ${match[2]} = ${scalars[match[1]!]};`);
  } else if ((match = /^typedef WGPUFlags (\w+);$/.exec(line))) {
    bitmasks.add(match[1]!);
    out.push(`pub type ${match[1]} = WGPUFlags;`);
  } else if ((match = /^static const (\w+) (\w+) = (0x[0-9A-F]+);$/.exec(line))) {
    assert(bitmasks.has(match[1]!), `${match[2]} is not of a bitmask`);
    out.push(`pub const ${match[2]}: ${match[1]} = ${match[3]};`);
  } else if ((match = /^typedef enum (\w+) \{$/.exec(line))) {
    const name = match[1]!;
    enums.add(name);
    const values: string[] = [];
    const names: string[] = [];
    for (i++; !lines[i]!.trim().startsWith("}"); i++) {
      const value = /^(\w+) = (0x[0-9A-F]+),?$/.exec(lines[i]!.trim());
      assert(value && value[1]!.startsWith(`${name}_`), `${name}: "${lines[i]}"`);
      const variant = value[1]!.slice(name.length + 1);
      if (variant === "Force32") continue;
      values.push(`    pub const ${identifier(variant)}: Self = Self(${value[2]});`);
      names.push(`(${JSON.stringify(variant)}, Self::${identifier(variant)})`);
    }
    // Not a Rust enum: Dawn may answer with a value that this header does not have.
    out.push(
      `#[repr(transparent)]\n#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]\npub struct ${name}(pub u32);\nimpl ${name} {\n${values.join("\n")}\n    /// Each of them, with what the header calls it.\n    pub const ALL: &'static [(&'static str, Self)] = &[${names.join(", ")}];\n}`,
    );
  } else if ((match = /^typedef (.+?)\(\*(WGPUProc\w*)\)\((.*)\) WGPU_FUNCTION_ATTRIBUTE;$/.exec(line))) {
    // The types of the functions below, for a table of them.
    if (match[2] === "WGPUProc") out.push(`pub type WGPUProc = Option<unsafe extern "C" fn()>;`);
  } else if ((match = /^typedef (.+?)\(\*(\w+)\)\((.*)\) WGPU_FUNCTION_ATTRIBUTE;$/.exec(line))) {
    callbacks.add(match[2]!);
    out.push(
      `pub type ${match[2]} = Option<unsafe extern "C" fn(${parseParameters(match[3]!)})${parseReturnType(match[1]!)}>;`,
    );
  } else if ((match = /^typedef struct (\w+) \{$/.exec(line))) {
    const struct: Struct = { name: match[1]!, fields: [] };
    for (i++; !lines[i]!.trim().startsWith("}"); i++) {
      const field = lines[i]!.trim();
      if (field === "") continue;
      assert(field.endsWith(";"), `${struct.name}: "${field}"`);
      struct.fields.push(parseDeclarator(field.slice(0, -1)));
    }
    structs.set(struct.name, struct);
  } else if ((match = /^WGPU_EXPORT (.+?)(wgpu\w+)\((.*)\) WGPU_FUNCTION_ATTRIBUTE;$/.exec(line))) {
    out.push(
      `unsafe extern "C" {\n    pub fn ${match[2]}(${parseParameters(match[3]!)})${parseReturnType(match[1]!)};\n}`,
    );
  } else {
    assert.fail(`webgpu.h:${i + 1}: no declaration is shaped like "${line}"`);
  }
}

/** `.a=X _wgpu_COMMA .b=_wgpu_MAKE_INIT_STRUCT(T, { .. }) _wgpu_COMMA` */
function parseInitializer(structName: string, body: string): string {
  const struct = structs.get(structName);
  assert(struct, `an initializer of ${structName}, which is not a struct`);
  const values = new Map<string, string>();
  let rest = body.trim();
  while (rest !== "") {
    const field = /^\.(\w+)=/.exec(rest);
    assert(field, `${structName}: "${rest}"`);
    rest = rest.slice(field[0].length);
    let depth = 0;
    let end = 0;
    for (; end < rest.length; end++) {
      if (rest[end] === "(" || rest[end] === "{") depth++;
      else if (rest[end] === ")" || rest[end] === "}") depth--;
      else if (depth === 0 && rest.startsWith("_wgpu_COMMA", end)) break;
    }
    values.set(field[1]!, rest.slice(0, end).trim());
    rest = rest.slice(end + "_wgpu_COMMA".length).trim();
  }
  assert.deepEqual(
    [...values.keys()],
    struct.fields.map(field => field.name),
    `${structName}: its initializer`,
  );
  const fields = struct.fields.map(({ name, type }) => `${identifier(name)}: ${rustValue(values.get(name)!, type)}`);
  return `${structName} { ${fields.join(", ")} }`;
}

function zeroValue(type: string): string {
  if (callbacks.has(type)) return "None";
  if (type.startsWith("*const")) return "core::ptr::null()";
  if (type.startsWith("*mut") || handles.has(type)) return "core::ptr::null_mut()";
  if (enums.has(type)) return `${type}(0)`;
  const struct = structs.get(type);
  if (!struct) return type.startsWith("f") ? `0_${type}` : "0";
  return `${type} { ${struct.fields.map(field => `${identifier(field.name)}: ${zeroValue(field.type)}`).join(", ")} }`;
}

function rustValue(value: string, type: string): string {
  let match: RegExpExecArray | null;
  if (value === "NULL" || value === "nullptr") {
    if (callbacks.has(type)) return "None";
    return type.startsWith("*const") ? "core::ptr::null()" : "core::ptr::null_mut()";
  }
  if ((match = /^_wgpu_MAKE_INIT_STRUCT\((\w+), \{(.*)\}\)$/.exec(value)))
    return parseInitializer(match[1]!, match[2]!);
  if ((match = /^_wgpu_ENUM_ZERO_INIT\((\w+)\)$/.exec(value))) return `${match[1]}(0)`;
  if (value === "_wgpu_STRUCT_ZERO_INIT") return zeroValue(type);
  if (initializers.has(value)) return `${initializers.get(value)!.struct}::INIT`;
  if (/^WGPU_[A-Z0-9_]+$/.test(value)) return value;
  if ((match = /^(\d+\.\d*)f?$/.exec(value))) return `${Number(match[1])}_${type}`;
  if (/^(0x[0-9A-Fa-f]+|\d+)$/.test(value)) return type.startsWith("f") ? `${value}_${type}` : value;
  if (enums.has(type) && value.startsWith(`${type}_`)) return `${type}::${identifier(value.slice(type.length + 1))}`;
  if (bitmasks.has(type) && value.startsWith(`${type}_`)) return value;
  assert.fail(`a ${type} that is ${value}`);
}

const initializerOf = new Map([...initializers.values()].map(({ struct, body }) => [struct, body]));
for (const { name, fields } of structs.values()) {
  out.push(
    `#[repr(C)]\n#[derive(Clone, Copy)]\npub struct ${name} {\n${fields.map(field => `    pub ${identifier(field.name)}: ${field.type},`).join("\n")}\n}`,
  );
  const body = initializerOf.get(name);
  if (body === undefined) continue;
  out.push(
    `impl ${name} {\n    /// \`${[...initializers].find(([, value]) => value.struct === name)![0]}\`\n    pub const INIT: Self = ${parseInitializer(name, body)};\n}\nimpl Default for ${name} {\n    #[inline]\n    fn default() -> Self {\n        Self::INIT\n    }\n}`,
  );
}

writeIfNotChanged(
  outputPath,
  `// Generated by src/codegen/generate-webgpu-sys.ts from Dawn's webgpu.h.

use core::ffi::{c_char, c_int, c_void};

${out.join("\n")}
`,
);
