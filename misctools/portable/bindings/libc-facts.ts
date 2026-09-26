// What the `libc` crate declares for a target, as the compiler sees it: every function with its
// arguments, every structure with its fields, every constant with its value.
//
//   bun libc-facts.ts <target triple> [name]...     prints the items of those names, as JSON
//
// The `libc` crate picks its definitions with `cfg`, so they are read from the documentation that
// rustdoc writes as JSON for the crate, built for the target: that is the crate after `cfg`, with the
// values of the constants evaluated. Nothing is linked and nothing runs, so a target of another system
// needs no SDK. The version of the crate is the one of the Cargo.lock of the repository.
//
// WORK (default /tmp/portable/n3) holds the scratch project and the documentation.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const here = dirname(import.meta.path);
const repo = resolve(here, "../../..");

export type TypeRef =
  | { kind: "primitive"; name: string }
  | { kind: "named"; name: string }
  | { kind: "pointer"; mutable: boolean; to: TypeRef }
  | { kind: "array"; of: TypeRef; length: string }
  | { kind: "function"; inputs: TypeRef[]; output: TypeRef | null; variadic: boolean; abi: string }
  | { kind: "option"; of: TypeRef }
  | { kind: "tuple"; of: TypeRef[] }
  | { kind: "other"; text: string };

export type Item = {
  name: string;
  kind: "function" | "constant" | "struct" | "union" | "type_alias" | "static" | "enum" | "other";
  /** Relative to the root of the crate, and the line. */
  file: string;
  line: number;
  /** constant: its value as rustdoc prints it (`512i32`), and as a number. static: nothing. */
  value?: string;
  number?: string;
  type?: TypeRef;
  inputs?: { name: string; type: TypeRef }[];
  output?: TypeRef | null;
  variadic?: boolean;
  /** function: the symbol, when it is not the name. */
  symbol?: string;
  fields?: { name: string; type: TypeRef; public: boolean }[];
  /** `repr(packed(n))` and `repr(align(n))`. */
  packed?: number;
  align?: number;
};

export type Facts = { target: string; version: string; byName: Map<string, Item[]> };

export function libcVersion(): string {
  const lock = readFileSync(join(repo, "Cargo.lock"), "utf8");
  const found = /name = "libc"\nversion = "([^"]+)"/.exec(lock);
  if (!found) throw new Error("Cargo.lock names no libc");
  return found[1];
}

function typeRef(t: any): TypeRef {
  if (t === null || t === undefined) return { kind: "other", text: "()" };
  if (t.primitive) return { kind: "primitive", name: t.primitive };
  if (t.resolved_path) {
    const name = String(t.resolved_path.path).split("::").pop()!;
    const args = t.resolved_path.args?.angle_bracketed?.args ?? [];
    if (name === "Option" && args.length === 1 && args[0].type) return { kind: "option", of: typeRef(args[0].type) };
    return { kind: "named", name };
  }
  if (t.raw_pointer) return { kind: "pointer", mutable: t.raw_pointer.is_mutable, to: typeRef(t.raw_pointer.type) };
  if (t.array) return { kind: "array", of: typeRef(t.array.type), length: String(t.array.len) };
  if (t.function_pointer) {
    const sig = t.function_pointer.sig;
    const abi = t.function_pointer.header?.abi;
    return {
      kind: "function",
      inputs: sig.inputs.map((input: [string, any]) => typeRef(input[1])),
      output: sig.output ? typeRef(sig.output) : null,
      variadic: !!sig.is_c_variadic,
      abi: typeof abi === "string" ? abi : Object.keys(abi ?? { C: 0 })[0],
    };
  }
  if (t.tuple) return { kind: "tuple", of: t.tuple.map(typeRef) };
  return { kind: "other", text: JSON.stringify(t) };
}

export function load(target: string, work = process.env.WORK ?? "/tmp/portable/n3"): Facts {
  const version = libcVersion();
  const project = join(work, "libc-facts");
  const json = join(project, "target", target, "doc", "libc.json");
  if (!existsSync(json)) {
    mkdirSync(join(project, "src"), { recursive: true });
    writeFileSync(join(project, "Cargo.toml"), `[workspace]\n\n[package]\nname = "libc-facts"\nversion = "0.0.0"\nedition = "2024"\n\n[dependencies]\nlibc = "=${version}"\n`);
    writeFileSync(join(project, "src/lib.rs"), "");
    const result = Bun.spawnSync(["cargo", "rustdoc", "--offline", "-p", "libc", "--target", target, "--", "-Zunstable-options", "--output-format", "json", "--document-private-items"], {
      cwd: project,
      env: { ...process.env, CARGO_TARGET_DIR: join(project, "target"), CARGO_BUILD_JOBS: "8" },
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) throw new Error(`rustdoc of libc for ${target}:\n${result.stderr.toString().split("\n").slice(-20).join("\n")}`);
  }
  const doc = JSON.parse(readFileSync(json, "utf8"));
  const index: Record<string, any> = doc.index;
  const byName = new Map<string, Item[]>();
  const root = /\/libc-[0-9.]+\/(.*)$/;
  for (const raw of Object.values<any>(index)) {
    if (!raw.name || raw.crate_id !== 0 || !raw.span) continue;
    const inner = raw.inner;
    const kindName = Object.keys(inner)[0];
    const file = root.exec(raw.span.filename)?.[1] ?? raw.span.filename;
    const item: Item = { name: raw.name, kind: "other", file, line: raw.span.begin[0] };
    if (kindName === "function") {
      item.kind = "function";
      const sig = inner.function.sig;
      item.inputs = sig.inputs.map((input: [string, any]) => ({ name: input[0], type: typeRef(input[1]) }));
      item.output = sig.output ? typeRef(sig.output) : null;
      item.variadic = !!sig.is_c_variadic;
      if (inner.function.has_body) continue;
      for (const attribute of raw.attrs ?? []) {
        const link = /LinkName \{name: "([^"]+)"/.exec(typeof attribute === "string" ? attribute : (attribute.other ?? ""));
        if (link) item.symbol = link[1];
      }
    } else if (kindName === "constant") {
      item.kind = "constant";
      item.type = typeRef(inner.constant.type);
      item.value = inner.constant.const.value ?? undefined;
      // rustdoc writes 16_777_216i32.
      const number = /^(-?[\d_]+)/.exec(item.value ?? "");
      if (number) item.number = number[1].replaceAll("_", "");
    } else if (kindName === "struct" || kindName === "union") {
      item.kind = kindName;
      const ids: number[] = kindName === "struct" ? (inner.struct.kind.plain?.fields ?? []) : inner.union.fields;
      if (kindName === "struct" && !inner.struct.kind.plain) continue;
      item.fields = ids.map(id => index[id]).filter(Boolean).map(field => ({ name: field.name, type: typeRef(field.inner.struct_field), public: field.visibility === "public" }));
      for (const attribute of raw.attrs ?? []) {
        const repr = typeof attribute === "object" ? attribute.repr : undefined;
        if (!repr) continue;
        if (repr.kind !== "c") item.kind = "other";
        if (typeof repr.packed === "number") item.packed = repr.packed;
        if (typeof repr.align === "number") item.align = repr.align;
      }
      if (item.kind === "other") continue;
    } else if (kindName === "type_alias") {
      item.kind = "type_alias";
      item.type = typeRef(inner.type_alias.type);
    } else if (kindName === "static") {
      item.kind = "static";
      item.type = typeRef(inner.static.type);
    } else if (kindName === "enum") {
      item.kind = "enum";
    } else continue;
    if (raw.visibility !== "public" && item.kind !== "struct") continue;
    if (!byName.has(item.name)) byName.set(item.name, []);
    byName.get(item.name)!.push(item);
  }
  return { target, version, byName };
}

/** The type with every name of the crate replaced by what it stands for, down to the primitive types. */
export function explicit(facts: Facts, type: TypeRef, depth = 0): TypeRef {
  if (depth > 12) return type;
  switch (type.kind) {
    case "named": {
      const alias = facts.byName.get(type.name)?.find(item => item.kind === "type_alias");
      if (alias?.type) return explicit(facts, alias.type, depth + 1);
      return type;
    }
    case "pointer":
      return { ...type, to: explicit(facts, type.to, depth + 1) };
    case "array":
      return { ...type, of: explicit(facts, type.of, depth + 1) };
    case "option":
      return { ...type, of: explicit(facts, type.of, depth + 1) };
    case "function":
      return { ...type, inputs: type.inputs.map(t => explicit(facts, t, depth + 1)), output: type.output ? explicit(facts, type.output, depth + 1) : null };
    default:
      return type;
  }
}

const coreTypes: Record<string, string> = {
  c_void: "core::ffi::c_void",
  c_char: "i8",
  c_schar: "i8",
  c_uchar: "u8",
  c_short: "i16",
  c_ushort: "u16",
  c_int: "i32",
  c_uint: "u32",
  c_long: "i64",
  c_ulong: "u64",
  c_longlong: "i64",
  c_ulonglong: "u64",
  c_float: "f32",
  c_double: "f64",
};

/** Rust source for the type. The integer types of C are written with their size on a 64-bit target that is not Windows. */
export function rust(type: TypeRef, name: (n: string) => string = n => n): string {
  switch (type.kind) {
    case "primitive":
      return type.name === "never" ? "!" : type.name;
    case "named":
      return coreTypes[type.name] ?? name(type.name);
    case "pointer":
      return `*${type.mutable ? "mut" : "const"} ${rust(type.to, name)}`;
    case "array":
      return `[${rust(type.of, name)}; ${type.length}]`;
    case "option":
      return `Option<${rust(type.of, name)}>`;
    case "function":
      return `${type.abi === "Rust" ? "" : `unsafe extern "${type.abi}" `}fn(${type.inputs.map(t => rust(t, name)).join(", ")}${type.variadic ? ", ..." : ""})${type.output ? ` -> ${rust(type.output, name)}` : ""}`;
    case "tuple":
      return `(${type.of.map(t => rust(t, name)).join(", ")})`;
    case "other":
      return type.text;
  }
}

if (import.meta.main) {
  const [target, ...names] = process.argv.slice(2);
  if (!target) throw new Error("usage: bun libc-facts.ts <target triple> [name]...");
  const facts = load(target);
  if (!names.length) console.log(JSON.stringify({ target, version: facts.version, names: facts.byName.size }));
  for (const name of names) console.log(JSON.stringify(facts.byName.get(name) ?? null, null, 1));
}
