// From the dawn.json that Dawn generates webgpu.h from: the Rust for src/dawn_sys, and C++ that holds every value, offset and signature of it to the header.

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pascalCase, rustIdent, snakeCase } from "./bindgen-lib-internal.ts";
import { writeIfNotChanged } from "./helpers.ts";

/** What has tags is not part of the standard header. These are wanted all the same. */
const extensions = new Set(["dawn compilation message utf16", "device.inject error", "device.set logging callback"]);

/** For windows and video frames, replaced by src/dawn_sys/Host.cpp, or answered by src/runtime/webgpu itself. */
const omitted = new Set([
  "adapter.request device",
  "buffer.get map state",
  "buffer.get size",
  "buffer.get usage",
  "buffer.read mapped range",
  "buffer.write mapped range",
  "command encoder.write timestamp",
  "device.destroy",
  "device.get lost future",
  "external texture",
  "external texture binding entry",
  "instance.create surface",
  "instance.has WGSL language feature",
  "instance.request adapter",
  "instance.wait any",
  "query set.get count",
  "query set.get type",
  "shader source SPIRV",
  "surface",
  "texture.get depth or array layers",
  "texture.get dimension",
  "texture.get format",
  "texture.get height",
  "texture.get mip level count",
  "texture.get sample count",
  "texture.get usage",
  "texture.get width",
]);

interface Member {
  name: string;
  type: string;
  annotation?: "*" | "const*" | "const*const*";
  length?: string | number;
  optional?: boolean;
  array_element_optional?: boolean;
  default?: string | number;
}
interface Method {
  name: string;
  tags?: string[];
  args?: Member[];
  returns?: string | { type: string; optional?: boolean };
}
interface Item {
  category: string;
  tags?: string[];
  values: { name: string; value: number; tags?: string[]; jsrepr?: string }[];
  members: Member[];
  methods: Method[];
  args: Member[];
  extensible?: "in" | "out" | false;
  chained?: "in" | "out";
  "chain roots"?: string[];
  out?: boolean;
  type: string;
  value: string;
}

const [jsonPath, outputDirectory] = process.argv.slice(2);
const items = new Map(Object.entries<Item>(JSON.parse(readFileSync(jsonPath, "utf8"))));
const item = (name: string) => items.get(name) ?? assert.fail(`dawn.json has no ${name}`);

for (const name of [...extensions, ...omitted]) {
  const [type, method] = name.split(".");
  assert(!method || item(type).methods.some(({ name }) => name === method), `dawn.json has no ${name}`);
}

const isWanted = (name: string, { tags }: { tags?: string[] }) => !omitted.has(name) && (!tags || extensions.has(name));
const methodsOf = (object: string) => item(object).methods.filter(m => isWanted(`${object}.${m.name}`, m));
const returnOf = ({ returns }: Method) => (typeof returns === "string" ? { type: returns } : returns);

// ─── What the methods reach ───

const reached = new Set<string>();
function reach(name: string): void {
  if (reached.has(name)) return;
  reached.add(name);
  const { category, members, args } = item(name);
  if (category === "object") {
    for (const method of methodsOf(name)) {
      for (const arg of method.args ?? []) reach(arg.type);
      const result = returnOf(method);
      if (result) reach(result.type);
    }
  } else if (category === "structure" || category === "callback info") {
    for (const member of members) reach(member.type);
    for (const [other, extension] of items)
      if (extension["chain roots"]?.includes(name) && isWanted(other, extension)) reach(other);
  } else if (category === "callback function") {
    for (const arg of args) reach(arg.type);
  }
}
for (const root of ["instance", "adapter", "device", "s type"]) reach(root);
// What the functions of Host.cpp take.
for (const root of ["feature level", "power preference", "device descriptor", "request device status"]) reach(root);
const reachedOf = (...categories: string[]) => [...reached].filter(name => categories.includes(item(name).category));

// ─── Names ───

const camelCase = (name: string) => name.replace(/ (.)/g, (_, first: string) => first.toUpperCase());
const typeName = (name: string) => name[0].toUpperCase() + camelCase(name).slice(1);
const fieldName = (name: string) =>
  rustIdent(name.includes(" ") ? name.toLowerCase().replaceAll(" ", "_") : snakeCase(name));
const constantName = (name: string) => name.toUpperCase().replaceAll(" ", "_");

/** The string of the WebIDL enumeration, if the value has one. */
function jsName({ name, jsrepr }: Item["values"][number]): string | undefined {
  if (jsrepr !== undefined) return /^'(.*)'$/.exec(jsrepr)?.[1];
  return name.toLowerCase().replace(/(\d?) /g, (_, digit: string) => digit || "-");
}

/** What bindgen calls the variant for that string, which is how `rustInto` of a `b.enumeration` pairs them. */
function variantName(value: Item["values"][number]): string {
  const name = pascalCase((jsName(value) ?? value.name).replace(/^(\d)d/, "d$1"));
  return /^\d/.test(name) ? pascalCase(value.name) : name;
}

// ─── Types ───

const natives: Record<string, { rust: string; cpp: string; size: number }> = {
  "bool": { rust: "Bool", cpp: "WGPUBool", size: 4 },
  "double": { rust: "f64", cpp: "double", size: 8 },
  "float": { rust: "f32", cpp: "float", size: 4 },
  "int32_t": { rust: "i32", cpp: "int32_t", size: 4 },
  "size_t": { rust: "usize", cpp: "size_t", size: 8 },
  "uint16_t": { rust: "u16", cpp: "uint16_t", size: 2 },
  "uint32_t": { rust: "u32", cpp: "uint32_t", size: 4 },
  "uint64_t": { rust: "u64", cpp: "uint64_t", size: 8 },
  "void": { rust: "u8", cpp: "void", size: 1 },
  "void *": { rust: "*mut u8", cpp: "void*", size: 8 },
  "void const *": { rust: "*const u8", cpp: "void const*", size: 8 },
};
const native = (name: string) => natives[name] ?? assert.fail(`no Rust type for ${name}`);

const isStringView = (name: string) => name === "string view";
const isPointer = (member: Member) => member.annotation !== undefined || isStringView(member.type);
const isOutput = (name: string) => item(name).out === true || (item(name).extensible || item(name).chained) === "out";
/** Dawn allocates what it points to. */
const ownsMembers = (name: string) => isOutput(name) && item(name).members.some(isPointer);

function borrows(name: string): boolean {
  const { category, extensible, chained, members } = item(name);
  if (category === "object" || isStringView(name)) return true;
  if (category !== "structure" || isOutput(name)) return false;
  return !!extensible || !!chained || members.some(member => isPointer(member) || borrows(member.type));
}

/** Dawn copies the callback out of it and calls that once, so it can be passed once. */
function holdsCallback(name: string): boolean {
  const { category, members } = item(name);
  return category === "callback info" || (category === "structure" && members.some(m => holdsCallback(m.type)));
}

function rustType(member: Member, lifetime: "'a" | "'_" | "'static"): string {
  const { type, annotation, length, optional } = member;
  const reference = lifetime === "'_" ? "&" : `&${lifetime} `;
  const option = (inner: string, isOptional = optional) => (isOptional ? `Option<${inner}>` : inner);
  const { category } = item(type);
  const value =
    category === "native"
      ? native(type).rust
      : category === "object"
        ? `${reference}${typeName(type)}`
        : `${typeName(type)}${borrows(type) ? `<${lifetime}>` : ""}`;
  if (typeof length === "string") return `Slice<${lifetime}, ${option(value, member.array_element_optional)}>`;
  if (annotation === undefined) return category === "object" ? option(value) : value;
  assert(annotation !== "const*const*", `no Rust type for ${member.name}`);
  return option(`${reference}${annotation === "*" ? "mut " : ""}${value}`);
}

function cppType({ type, annotation }: Pick<Member, "type" | "annotation">): string {
  const value = item(type).category === "native" ? native(type).cpp : `WGPU${typeName(type)}`;
  return annotation === undefined ? value : annotation === "*" ? `${value}*` : `${value} const*`;
}

interface Field {
  rust: string;
  type: string;
  /** What the `_INIT` macro gives it. Undefined: a reference, which C starts as NULL and Dawn does not check. */
  initial: string | undefined;
  cpp: string;
  size: number;
  align: number;
}

function initialValue(member: Member): string | undefined {
  const { type, annotation, length, optional, default: value } = member;
  const { category, values } = item(type);
  if (typeof length === "string") return "Slice::EMPTY";
  if (annotation !== undefined || category === "object") return optional ? "None" : undefined;
  if (isStringView(type)) return "StringView::NULL";
  const named = (name: unknown) => values.find(other => other.name === name);
  if (category === "enum") {
    const initial = named("undefined") ?? named(value);
    return initial ? `${typeName(type)}::${variantName(initial)}` : `${typeName(type)}(0)`;
  }
  if (category === "bitmask") return `${typeName(type)}::${variantName(named(value ?? "none")!)}`;
  if (category === "structure") {
    if (value === "zero") return `${typeName(type)}::ZERO`;
    return fieldsOf(type).every(field => field.initial !== undefined) ? "Default::default()" : undefined;
  }
  if (category === "callback info") return undefined;
  if (type === "bool") return `Bool::from(${value ?? false})`;
  if (items.get(`${value}`)?.category === "constant") return constantName(`${value}`);
  const number = `${value ?? 0}`.replace(/\.f$/, "");
  return type === "float" || type === "double" ? `${number}.0` : number;
}

function layoutOf(name: string): { size: number; align: number } {
  const scalar = (size: number) => ({ size, align: size });
  const { category } = item(name);
  if (category === "native") return scalar(native(name).size);
  if (category === "enum") return scalar(4);
  if (category !== "structure" && category !== "callback info") return scalar(8);
  if (isStringView(name)) return { size: 16, align: 8 };
  const fields = fieldsOf(name);
  const align = Math.max(...fields.map(field => field.align));
  const size = offsetsOf(fields).at(-1)! + fields.at(-1)!.size;
  return { size: Math.ceil(size / align) * align, align };
}

function offsetsOf(fields: Field[]): number[] {
  let end = 0;
  return fields.map(({ size, align }) => {
    const offset = Math.ceil(end / align) * align;
    end = offset + size;
    return offset;
  });
}

function fieldsOf(name: string): Field[] {
  const { category, extensible, chained, members } = item(name);
  const lifetime = borrows(name) ? "'a" : "'static";
  const pointer = { size: 8, align: 8 };
  const fields: Field[] = [];
  if (chained) {
    const type = `ChainedStruct<${lifetime}, ${typeName(name)}${borrows(name) ? "<'static>" : ""}>`;
    fields.push({ rust: "chain", type, initial: "Default::default()", cpp: "chain", size: 16, align: 8 });
  } else if (extensible || category === "callback info") {
    fields.push({
      rust: "next_in_chain",
      type: `Chain<${lifetime}>`,
      initial: "Chain::END",
      cpp: "nextInChain",
      ...pointer,
    });
  }
  members.forEach((member, i) => {
    if (members[i + 1]?.length === member.name) return;
    const isSlice = typeof member.length === "string";
    assert(!isSlice || (members[i - 1].name === member.length && members[i - 1].type === "size_t"), member.name);
    fields.push({
      rust: fieldName(member.name),
      type: rustType(member, lifetime),
      initial: initialValue(member),
      cpp: camelCase(isSlice ? members[i - 1].name : member.name),
      ...(isSlice ? { size: 16, align: 8 } : member.annotation ? pointer : layoutOf(member.type)),
    });
  });
  if (category === "callback info")
    for (const rust of ["userdata1", "userdata2"])
      fields.push({ rust, type: "*mut c_void", initial: undefined, cpp: rust, ...pointer });
  return fields;
}

const rust: string[] = [];
const externs: string[] = [];
const cpp: string[] = [];

// ─── Constants, enumerations ───

const usedConstants = new Set([
  ...reachedOf("structure").flatMap(name => item(name).members.map(member => `${member.default}`)),
  "whole map size",
]);
for (const [name, { category, type, value }] of items) {
  if (category !== "constant" || !usedConstants.has(name)) continue;
  const rustName = native(type).rust;
  rust.push(`pub const ${constantName(name)}: ${rustName} = ${rustName}::${value === "NAN" ? "NAN" : "MAX"};`);
  if (value !== "NAN") cpp.push(`static_assert(WGPU_${constantName(name)} == std::numeric_limits<${type}>::max());`);
}

for (const name of reachedOf("enum", "bitmask")) {
  const isEnum = item(name).category === "enum";
  const values = item(name).values.filter(value => (name === "s type" ? reached.has(value.name) : !value.tags));
  const numbers = values.map(({ value, tags }) => value + (tags?.includes("dawn") ? 0x0005_0000 : 0));
  rust.push(
    "#[repr(transparent)]",
    "#[derive(Clone, Copy, PartialEq, Eq)]",
    `pub struct ${typeName(name)}(${isEnum ? "u32" : "u64"});`,
    `impl ${typeName(name)} {`,
    ...values.map((value, i) => `    pub const ${variantName(value)}: Self = Self(${numbers[i]});`),
  );
  if (!isEnum) rust.push("    pub const fn from_bits(bits: u32) -> Self { Self(bits as u64) }");
  if (name.endsWith("feature name"))
    rust.push(
      "    /// What JavaScript calls it. `None` for Dawn's own.",
      "    pub fn name(self) -> Option<&'static str> {",
      "        match self {",
      ...values.map(value => `            Self::${variantName(value)} => Some("${jsName(value)}"),`),
      "            _ => None,",
      "        }",
      "    }",
    );
  rust.push("}");
  cpp.push(`static_assert(sizeof(WGPU${typeName(name)}) == ${isEnum ? 4 : 8});`);
  values.forEach((value, i) =>
    cpp.push(`static_assert(WGPU${typeName(name)}_${typeName(value.name)} == ${numbers[i]});`),
  );
}

// ─── Structures ───

const zeroed = new Set(
  reachedOf("structure").flatMap(name =>
    item(name)
      .members.filter(m => m.default === "zero")
      .map(m => m.type),
  ),
);

for (const name of reachedOf("structure", "callback info")) {
  if (isStringView(name)) continue;
  const { category, chained, extensible, members } = item(name);
  const fields = fieldsOf(name);
  const type = typeName(name);
  const anyLifetime = borrows(name) ? "<'_>" : "";
  const isPrivate = (field: Field) => category === "callback info" || (isOutput(name) && /'static/.test(field.type));

  rust.push("#[repr(C)]");
  if (!ownsMembers(name) && !holdsCallback(name) && extensible !== "out") rust.push("#[derive(Clone, Copy)]");
  rust.push(
    `pub struct ${type}${borrows(name) ? "<'a>" : ""} {`,
    ...fields.map(field => `    ${isPrivate(field) ? "pub(crate)" : "pub"} ${field.rust}: ${field.type},`),
    "}",
  );

  if (fields.every(field => field.initial !== undefined))
    rust.push(
      `impl Default for ${type}${anyLifetime} {`,
      `    fn default() -> Self { Self { ${fields.map(field => `${field.rust}: ${field.initial}`).join(", ")} } }`,
      "}",
    );
  if (zeroed.has(name)) {
    const zero = ({ type }: Field) => (type.startsWith("Chain<") ? "Chain::END" : type === "u64" ? "0" : `${type}(0)`);
    rust.push(
      `impl ${type}${anyLifetime} {`,
      `    const ZERO: Self = Self { ${fields.map(field => `${field.rust}: ${zero(field)}`).join(", ")} };`,
      "}",
    );
  }
  if (chained) {
    const sType = variantName(item("s type").values.find(value => value.name === name)!);
    rust.push(
      "// SAFETY: it starts with a `ChainedStruct`, and this is the type the header gives that.",
      `unsafe impl Chained for ${type}${anyLifetime} { const S_TYPE: SType = SType::${sType}; }`,
    );
  }
  if (ownsMembers(name)) {
    rust.push(`impl ${type} {`);
    for (const member of members.filter(isPointer)) {
      const field = fieldName(member.name);
      rust.push(
        isStringView(member.type)
          ? `    pub fn ${field}(&self) -> &[u8] { self.${field}.as_bytes() }`
          : `    pub fn ${field}(&self) -> &[${typeName(member.type)}] { self.${field}.as_slice() }`,
      );
    }
    rust.push(
      "}",
      `impl Drop for ${type} {`,
      "    fn drop(&mut self) {",
      "        // SAFETY: only Dawn sets the pointers, and `self` is not read again.",
      `        unsafe { wgpu${type}FreeMembers(core::ptr::read(self)) }`,
      "    }",
      "}",
    );
    externs.push(`    fn wgpu${type}FreeMembers(value: ${type});`);
    cpp.push(`static_assert(std::is_same_v<decltype(&wgpu${type}FreeMembers), void (*)(WGPU${type})>);`);
  }

  const { size } = layoutOf(name);
  const concrete = `${type}${borrows(name) ? "<'static>" : ""}`;
  rust.push(`const _: () = assert!(size_of::<${concrete}>() == ${size});`);
  cpp.push(`static_assert(sizeof(WGPU${type}) == ${size});`);
  offsetsOf(fields).forEach((offset, i) => {
    rust.push(`const _: () = assert!(offset_of!(${concrete}, ${fields[i].rust}) == ${offset});`);
    cpp.push(`static_assert(offsetof(WGPU${type}, ${fields[i].cpp}) == ${offset});`);
  });
  for (const member of members)
    cpp.push(`static_assert(std::is_same_v<decltype(WGPU${type}::${camelCase(member.name)}), ${cppType(member)}>);`);
}

// ─── Callbacks ───

for (const info of reachedOf("callback info")) {
  const { members } = item(info);
  const name = members.find(member => member.name === "callback")!.type;
  const { args } = item(name);
  const isDevice = (arg: Member) => arg.length === 1;
  // An object comes with a reference. A callback that is cancelled gets NULL whatever dawn.json says.
  const argType = (arg: Member) =>
    isDevice(arg)
      ? "*const c_void"
      : item(arg.type).category === "object"
        ? `Option<Ref<${typeName(arg.type)}>>`
        : rustType({ ...arg, optional: true }, "'_");
  rust.push(
    `type ${typeName(name)} = unsafe extern "C" fn(${[...args.map(argType), "*mut c_void", "*mut c_void"].join(", ")});`,
  );
  cpp.push(
    `static_assert(std::is_same_v<WGPU${typeName(name)}, void (*)(${[...args.map(cppType), "void*", "void*"].join(", ")})>);`,
  );

  // src/dawn_sys/host.rs fills in the callbacks of a device.
  if (args.some(isDevice) || !members.some(member => member.name === "mode")) continue;
  const signature = `(${args.map(argType).join(", ")})`;
  const parameters = args.map(arg => `${fieldName(arg.name)}: ${argType(arg)}`).join(", ");
  rust.push(
    `impl ${typeName(info)} {`,
    "    /// `callback` runs once, in `Instance::process_events` or when the instance is released.",
    `    pub fn new<F: FnOnce${signature} + 'static>(callback: F) -> Self {`,
    `        unsafe extern "C" fn call<F: FnOnce${signature}>(${parameters}, callback: *mut c_void, _: *mut c_void) {`,
    "            // SAFETY: the box below. Dawn calls this once.",
    `            (unsafe { heap::take(callback.cast::<F>()) })(${args.map(arg => fieldName(arg.name)).join(", ")})`,
    "        }",
    "        Self {",
    "            next_in_chain: Chain::END,",
    "            mode: CallbackMode::AllowProcessEvents,",
    "            callback: call::<F>,",
    "            userdata1: heap::into_raw(Box::new(callback)).cast(),",
    "            userdata2: core::ptr::null_mut(),",
    "        }",
    "    }",
    "}",
  );
}

// ─── Objects ───

for (const object of reachedOf("object")) {
  const type = typeName(object);
  rust.push(
    `bun_opaque::opaque_ffi! { pub struct ${type}; }`,
    "// SAFETY: Dawn's own count of references.",
    `unsafe impl ExternalSharedDescriptor for ${type} {`,
    "    unsafe fn ext_ref(this: *mut Self) {",
    "        // SAFETY: the caller holds a reference.",
    `        unsafe { wgpu${type}AddRef(this) }`,
    "    }",
    "    unsafe fn ext_deref(this: *mut Self) {",
    "        let _pool = AutoreleasePool::new();",
    "        // SAFETY: the caller gives up a reference.",
    `        unsafe { wgpu${type}Release(this) }`,
    "    }",
    "}",
    `impl ${type} {`,
  );
  externs.push(`    fn wgpu${type}AddRef(this: *mut ${type});`, `    fn wgpu${type}Release(this: *mut ${type});`);

  for (const method of methodsOf(object)) {
    const symbol = `wgpu${type}${typeName(method.name)}`;
    const args = method.args ?? [];
    const parameters = ["&self"];
    const externParameters = [`this: &${type}`];
    const passed = ["self"];
    for (const arg of args) {
      const name = fieldName(arg.name);
      const counted = args.find(other => other.length === arg.name);
      if (counted) {
        externParameters.push(`${name}: usize`);
        passed.push(`${fieldName(counted.name)}.len()`);
      } else if (typeof arg.length === "string") {
        const element = rustType({ name: arg.name, type: arg.type }, "'_");
        parameters.push(`${name}: &[${element}]`);
        externParameters.push(`${name}: *const ${element}`);
        passed.push(`${name}.as_ptr()`);
      } else {
        parameters.push(`${name}: ${rustType(arg, "'_")}`);
        externParameters.push(`${name}: ${rustType(arg, "'_")}`);
        passed.push(name);
      }
    }

    const result = returnOf(method);
    const reference = result && `Ref<${typeName(result.type)}>`;
    const returns = !result
      ? ""
      : item(result.type).category !== "object"
        ? ` -> ${rustType({ name: "", type: result.type }, "'_")}`
        : ` -> ${result.optional ? `Option<${reference}>` : reference}`;
    rust.push(
      "    #[inline]",
      `    pub fn ${fieldName(method.name)}(${parameters.join(", ")})${returns} {`,
      "        let _pool = AutoreleasePool::new();",
      "        // SAFETY: every pointer is a live borrow, and every count is the length of its slice.",
      `        unsafe { ${symbol}(${passed.join(", ")}) }`,
      "    }",
    );
    externs.push(`    fn ${symbol}(${externParameters.join(", ")})${returns};`);
    const signature = `${result ? cppType(result) : "void"} (*)(${[`WGPU${type}`, ...args.map(cppType)].join(", ")})`;
    cpp.push(`static_assert(std::is_same_v<decltype(&${symbol}), ${signature}>);`);
  }
  rust.push("}");
}

const banner = "// Generated by src/codegen/generate-dawn-sys.ts from dawn.json.";
writeIfNotChanged(
  join(outputDirectory, "dawn_sys.rs"),
  [banner, ...rust, 'unsafe extern "C" {', ...externs, "}"].join("\n"),
);
writeIfNotChanged(
  join(outputDirectory, "DawnSysChecks.cpp"),
  [banner, ...["cstddef", "limits", "type_traits", "webgpu/webgpu.h"].map(h => `#include <${h}>`), ...cpp].join("\n"),
);
