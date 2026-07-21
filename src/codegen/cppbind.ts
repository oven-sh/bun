/*

cppbind - C++ binding generator for Bun

This tool automatically generates Rust bindings for C++ functions marked with [[ZIG_EXPORT(...)]] attributes.
It runs automatically when C++ files change during the build process.

To run manually:
    bun src/codegen/cppbind src build/debug/codegen

## USAGE

### Basic Export Tags

1. **nothrow** - Function that never throws exceptions:
   ```cpp
   extern "C" [[ZIG_EXPORT(nothrow)]] void hello_world() {
       printf("hello world\n");
   }
   ```
   Rust usage: `bun_jsc::cpp::hello_world();`

2. **zero_is_throw** - Function returns JSValue, where .zero indicates an exception:
   ```cpp
   extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSValue create_object(JSGlobalObject* globalThis) {
       auto scope = DECLARE_THROW_SCOPE();
       // ...
       RETURN_IF_EXCEPTION(scope, {});
       return result;
   }
   ```
   Rust usage: `bun_jsc::cpp::create_object(global_this)?;`

3. **check_slow** - Function that may throw, performs runtime exception checking:
   ```cpp
   extern "C" [[ZIG_EXPORT(check_slow)]] void process_data(JSGlobalObject* globalThis) {
       auto scope = DECLARE_THROW_SCOPE();
       // ...
       RETURN_IF_EXCEPTION(scope, );
   }
   ```
   Rust usage: `bun_jsc::cpp::process_data(global_this)?;`

### Parameters

- **[[ZIG_NONNULL]]** - Mark pointer parameters as non-nullable:
  ```cpp
  [[ZIG_EXPORT(nothrow)]] void process([[ZIG_NONNULL]] JSGlobalObject* globalThis,
                                        [[ZIG_NONNULL]] JSValue* values,
                                        size_t count) { ... }
  ```
  Generates: `pub extern fn process(globalThis: *jsc.JSGlobalObject, values: [*]const jsc.JSValue) void;`

*/

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringWidth } from "./helpers";
import { bannedTypes } from "./shared-types";

const start = Date.now();
// The build system runs `install` at the repo root before this script fires
// (see scripts/build/codegen.ts rootInstall); if @lezer/cpp is missing the
// only recovery is a manual install anyway.
const lezerGrammar = join(import.meta.dirname, "../../node_modules/@lezer/cpp/src/cpp.grammar");
if (!existsSync(lezerGrammar)) {
  console.error("Lezer C++ grammar is not installed. Run your package manager's install at the repo root.");
  process.exit(1);
}

type SyntaxNode = import("@lezer/common").SyntaxNode;
const { parser: cppParser } = await import("@lezer/cpp");

type Point = {
  line: number;
  column: number;
};
type Srcloc = {
  file: string;
  start: Point;
  end: Point;
};
type CppFn = {
  name: string;
  returnType: CppType;
  parameters: CppParameter[];
  position: Srcloc;
  tag: ExportTag;
};
type CppParameter = {
  type: CppType;
  name: string;
};
type CppType =
  | {
      type: "pointer";
      child: CppType;
      position: Srcloc;
      isConst: boolean;
      isMany: boolean;
      isNonNull: boolean;
    }
  | {
      type: "named";
      name: string;
      position: Srcloc;
    }
  | {
      type: "fn";
      parameters: CppParameter[];
      returnType: CppType;
      position: Srcloc;
    };

type PositionedError = {
  position: Srcloc;
  message: string;
  notes: { position: Srcloc; message: string }[];
};
const errors: PositionedError[] = [];
function appendError(position: Srcloc, message: string): PositionedError {
  const error: PositionedError = { position, message, notes: [] };
  errors.push(error);
  return error;
}
function appendErrorFromCatch(error: unknown, position: Srcloc): PositionedError {
  if (error instanceof PositionedErrorClass) {
    errors.push(error);
    return error;
  }
  if (error instanceof Error) {
    return appendError(position, error.message);
  }
  return appendError(position, "unknown error: " + JSON.stringify(error));
}
function throwError(position: Srcloc, message: string): never {
  throw new PositionedErrorClass(position, message);
}
class PositionedErrorClass extends Error {
  position: Srcloc;
  notes: { position: Srcloc; message: string }[] = [];
  constructor(position: Srcloc, message: string) {
    super(message);
    this.position = position;
  }
}

// Lezer works with offsets, but our errors need line/column. This utility handles the conversion.
class LineInfo {
  lineStarts: number[];
  constructor(source: string) {
    this.lineStarts = [0];
    for (let i = 0; i < source.length; i++) {
      if (source[i] === "\n") {
        this.lineStarts.push(i + 1);
      }
    }
  }

  get(offset: number): Point {
    // A binary search would be faster, but this is fine for files of this size.
    let line = 1;
    let lineStart = 0;
    for (let i = this.lineStarts.length - 1; i >= 0; i--) {
      if (this.lineStarts[i] <= offset) {
        line = i + 1;
        lineStart = this.lineStarts[i];
        break;
      }
    }
    const column = offset - lineStart + 1;
    return { line, column };
  }
}

// A context object to pass around file-specific parsing information.
type ParseContext = {
  file: string;
  sourceCode: string;
  lineInfo: LineInfo;
};

function nodePosition(node: SyntaxNode, ctx: ParseContext): Srcloc {
  return {
    file: ctx.file,
    start: ctx.lineInfo.get(node.from),
    end: ctx.lineInfo.get(node.to),
  };
}
const text = (node: SyntaxNode, ctx: ParseContext) => ctx.sourceCode.slice(node.from, node.to);

function assertNever(value: never): never {
  throw new Error("assertNever");
}

export function prettyPrintLezerNode(node: SyntaxNode, sourceCode: string): string {
  const lines: string[] = [];
  const printRecursive = (currentNode: SyntaxNode, prefix: string, isLast: boolean) => {
    // Determine the connector shape
    const connector = isLast ? "└─ " : "├─ ";
    const linePrefix = prefix + connector;

    // Get the node's text, escape newlines, and truncate for readability
    const nodeText = sourceCode.slice(currentNode.from, currentNode.to);
    let truncatedText = nodeText.replace(/\n/g, "\\n");
    if (truncatedText.length > 50) {
      truncatedText = truncatedText.slice(0, 50) + "...";
    }

    // Format and add the current node's line
    lines.push(`${linePrefix}${currentNode.name} [${currentNode.from}..${currentNode.to}] "${truncatedText}"`);
    if (currentNode.name === "CompoundStatement") {
      lines.push(prefix + "    └─ ...");
      return;
    }

    // Prepare the prefix for the children
    const childPrefix = prefix + (isLast ? "    " : "│   ");

    // Recurse for children
    const children: SyntaxNode[] = [];
    const cursor = currentNode.cursor();
    if (cursor.firstChild()) {
      do {
        children.push(cursor.node);
      } while (cursor.nextSibling());
    }

    children.forEach((child, index) => {
      printRecursive(child, childPrefix, index === children.length - 1);
    });
  };

  // Start the process for the root node without any prefix/connector
  const rootText = sourceCode.slice(node.from, node.to).replace(/\n/g, "\\n").slice(0, 50);
  lines.push(`${node.name} [${node.from}..${node.to}] "${rootText}${rootText.length === 50 ? "..." : ""}"`);

  const children: SyntaxNode[] = [];
  const cursor = node.cursor();
  if (cursor.firstChild()) {
    do {
      children.push(cursor.node);
    } while (cursor.nextSibling());
  }

  children.forEach((child, index) => {
    printRecursive(child, "", index === children.length - 1);
  });

  return lines.join("\n");
}

function getChildren(node: SyntaxNode): SyntaxNode[] {
  const children: SyntaxNode[] = [];
  let child = node.firstChild;
  while (child) {
    children.push(child);
    child = child.nextSibling;
  }
  return children;
}

const allowedLezerTypes = new Set(["PrimitiveType", "ScopedTypeIdentifier", "TypeIdentifier", "SizedTypeSpecifier"]);
function processRootmostType(ctx: ParseContext, node: SyntaxNode): CppType {
  const children = getChildren(node);
  for (const child of children) {
    if (allowedLezerTypes.has(child.type.name)) {
      return { type: "named", name: text(child, ctx), position: nodePosition(child, ctx) };
    }
  }
  throwError(nodePosition(node, ctx), "no valid type found:\n" + prettyPrintLezerNode(node, ctx.sourceCode));
}

function processDeclarator(
  ctx: ParseContext,
  node: SyntaxNode, // Initially a FunctionDefinition/ParameterDeclaration, then recursively a Declarator variant
  rootmostType?: CppType,
): { type: CppType; final: SyntaxNode } {
  // Initial entry point with a definition/declaration, find the top-level declarator
  if (node.name === "FunctionDefinition" || node.name === "ParameterDeclaration") {
    rootmostType ??= processRootmostType(ctx, node);
  } else {
    if (!rootmostType)
      throwError(
        nodePosition(node, ctx),
        "no rootmost type provided to declarator:\n" + prettyPrintLezerNode(node, ctx.sourceCode),
      );
  }

  const children = getChildren(node);
  const declarators = children.filter(child => child.name.endsWith("Declarator") || child.name === "Identifier");
  if (declarators.length !== 1) {
    throwError(
      nodePosition(node, ctx),
      "no or multiple declarators found:\n" + prettyPrintLezerNode(node, ctx.sourceCode),
    );
  }
  const declarator = declarators[0]!;

  // Recursively peel off pointers
  if (declarator?.name === "PointerDeclarator") {
    if (!rootmostType) throwError(nodePosition(declarator, ctx), "no rootmost type provided to PointerDeclarator");
    const isConst = !!declarator.parent?.getChild("const") || rootmostType.type === "fn";
    const parentAttributes = declarator.parent?.getChildren("Attribute") ?? [];
    const isNonNull = parentAttributes.some(attr => text(attr.getChild("AttributeName")!, ctx) === "ZIG_NONNULL");

    return processDeclarator(ctx, declarator, {
      type: "pointer",
      child: rootmostType,
      position: nodePosition(declarator, ctx),
      isConst,
      isNonNull,
      isMany: false,
    });
  } else if (declarator?.name === "ReferenceDeclarator") {
    throwError(nodePosition(declarator, ctx), "references are not allowed");
  } else if (declarator?.name === "FunctionDeclarator" && !declarator.getChild("Identifier")) {
    const lhs = declarator.getChild("ParenthesizedDeclarator");
    const rhs = declarator.getChild("ParameterList");
    if (!lhs || !rhs) {
      throwError(
        nodePosition(declarator, ctx),
        "FunctionDeclarator has neither Identifier nor ParenthesizedDeclarator:\n" +
          prettyPrintLezerNode(declarator, ctx.sourceCode),
      );
    }
    const fnType: CppType = {
      type: "fn",
      parameters: [],
      returnType: rootmostType,
      position: nodePosition(declarator, ctx),
    };
    for (const arg of rhs.getChildren("ParameterDeclaration")) {
      const paramDeclarator = processDeclarator(ctx, arg);
      fnType.parameters.push({ type: paramDeclarator.type, name: text(paramDeclarator.final, ctx) });
    }
    return processDeclarator(ctx, lhs, fnType);
  }

  return { type: rootmostType, final: declarator };
}

function processFunction(ctx: ParseContext, node: SyntaxNode, tag: ExportTag): CppFn {
  // `node` is a FunctionDefinition
  const declarator = processDeclarator(ctx, node);
  const final = declarator.final;

  if (final.name !== "FunctionDeclarator") {
    throwError(nodePosition(final, ctx), "not a function_declarator: " + final.name);
  }
  const nameNode = final.getChild("Identifier");
  if (!nameNode) throwError(nodePosition(final, ctx), "no name found:\n" + prettyPrintLezerNode(final, ctx.sourceCode));

  const parameterList = final.getChild("ParameterList");
  if (!parameterList) throwError(nodePosition(final, ctx), "no parameter list found");

  const parameters: CppParameter[] = [];
  for (const parameter of parameterList.getChildren("ParameterDeclaration")) {
    const paramDeclarator = processDeclarator(ctx, parameter);
    const name = paramDeclarator.final;

    if (name.name !== "Identifier") {
      throwError(nodePosition(name, ctx), "parameter name is not an identifier: " + name.name);
    }

    parameters.push({ type: paramDeclarator.type, name: text(name, ctx) });
  }

  for (let i = 0; i < parameters.length; i++) {
    const param = parameters[i];
    const next = parameters[i + 1];
    if (param.type.type === "pointer" && next?.type.type === "named" && next.type.name === "size_t") {
      param.type.isMany = true;
      i++;
    }
  }

  return {
    returnType: declarator.type,
    name: text(nameNode, ctx),
    parameters,
    position: nodePosition(nameNode, ctx),
    tag,
  };
}

type ExportTag = "check_slow" | "zero_is_throw" | "false_is_throw" | "null_is_throw" | "nothrow";

// ─────────────────────────── Rust output (cpp.rs) ───────────────────────────
//
// Each `[[ZIG_EXPORT(mode)]]` C++
// function gets a typed `pub fn` in `bun_jsc::cpp` that wraps the raw extern in
// the appropriate exception scope and converts to `JsResult`. The wrapper opens
// the scope *before* calling into C++ so the callee's `DECLARE_THROW_SCOPE` dtor
// (which sets `vm.m_needExceptionCheck` under `validateExceptionChecks=1`) is
// satisfied by the Rust scope's `exception()` query — without this, the next
// `JSGlobalObject__hasException` ctor asserts.
//
// Parameter and return types are emitted as raw C-ABI Rust types (pointers stay
// `*mut`/`*const`, no `&T` upgrade) so the wrappers compose with whatever
// newtypes the per-type ergonomic shims (`JSValue::get`, `JSPromise::resolve`,
// …) hold; those shims forward into `crate::cpp::*`.

// C++ named-type → Rust path. Unlisted types fall back to `core::ffi::c_void`
// (only ever appears behind a pointer in `extern "C"` signatures, so layout is
// irrelevant; the per-type shim casts back).
const rustSharedTypes: Record<string, string> = {
  // Primitives
  "bool": "bool",
  // `char` signedness is platform-dependent (signed on x86_64-linux/windows,
  // unsigned on aarch64); use `core::ffi::c_char` so a future by-value return
  // doesn't silently sign-flip.
  "char": "core::ffi::c_char",
  "unsigned char": "u8",
  "signed char": "i8",
  "char16_t": "u16",
  "short": "core::ffi::c_short",
  "unsigned short": "core::ffi::c_ushort",
  "int": "core::ffi::c_int",
  "unsigned": "core::ffi::c_uint",
  "unsigned int": "core::ffi::c_uint",
  "long": "core::ffi::c_long",
  "unsigned long": "core::ffi::c_ulong",
  "long long": "core::ffi::c_longlong",
  "unsigned long long": "core::ffi::c_ulonglong",
  "float": "f32",
  "double": "f64",
  "size_t": "usize",
  "ssize_t": "isize",
  "int8_t": "i8",
  "uint8_t": "u8",
  "int16_t": "i16",
  "uint16_t": "u16",
  "int32_t": "i32",
  "uint32_t": "u32",
  "int64_t": "i64",
  "uint64_t": "u64",

  // JSC / Bun
  "BunString": "bun_core::String",
  "JSC::EncodedJSValue": "crate::JSValue",
  "EncodedJSValue": "crate::JSValue",
  "JSC::JSGlobalObject": "crate::JSGlobalObject",
  "Zig::GlobalObject": "crate::JSGlobalObject",
  "ZigException": "crate::zig_exception::ZigException",
  "ZigString": "bun_core::ZigString",
  "JSC::VM": "crate::VM",
  "JSC::JSPromise": "crate::JSPromise",
  "JSC::JSMap": "crate::JSMap",
  "JSC::CustomGetterSetter": "crate::CustomGetterSetter",
  "JSC::SourceProvider": "crate::SourceProvider",
  "JSC::CallFrame": "crate::CallFrame",
  "JSC::JSObject": "crate::JSObject",
  "JSC::JSString": "crate::JSString",
  "JSC::Exception": "crate::Exception",
  "JSC::JSInternalPromise": "crate::JSInternalPromise",
  "WTF::StringImpl": "core::ffi::c_void",
  "WebCore::DOMURL": "crate::DOMURL",
  "WebCore::EventLoopTask": "crate::cpp_task::CppTask",
  // HTTPServerAgent / inspector types only show up in `nothrow` exports;
  // emit as opaque so the raw extern still type-checks.
  "Inspector::InspectorHTTPServerAgent": "core::ffi::c_void",
  // C++: `typedef int ServerId; typedef int HotReloadId;` (InspectorHTTPServerAgent.cpp)
  "HotReloadId": "core::ffi::c_int",
  "ServerId": "core::ffi::c_int",
  "Route": "core::ffi::c_void",
};

// Reserved words that can't be used as Rust identifiers verbatim.
const rustReserved = new Set([
  "as",
  "break",
  "const",
  "continue",
  "crate",
  "else",
  "enum",
  "extern",
  "false",
  "fn",
  "for",
  "if",
  "impl",
  "in",
  "let",
  "loop",
  "match",
  "mod",
  "move",
  "mut",
  "pub",
  "ref",
  "return",
  "self",
  "Self",
  "static",
  "struct",
  "super",
  "trait",
  "true",
  "type",
  "unsafe",
  "use",
  "where",
  "while",
  "async",
  "await",
  "dyn",
  "abstract",
  "become",
  "box",
  "do",
  "final",
  "macro",
  "override",
  "priv",
  "typeof",
  "unsized",
  "virtual",
  "yield",
  "try",
]);
function rustIdent(name: string): string {
  if (!name.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) return "_" + name.replace(/[^a-zA-Z0-9_]/g, "_");
  if (rustReserved.has(name)) return name + "_";
  return name;
}

function generateRustType(type: CppType, parent: CppType | null): string {
  if (type.type === "pointer") {
    const constKw = type.isConst ? "*const " : "*mut ";
    return constKw + generateRustType(type.child, type);
  }
  if (type.type === "fn") {
    // Function pointers are nullable in C; model as Option<extern "C" fn(...)>.
    const params = type.parameters.map(p => generateRustType(p.type, null)).join(", ");
    return `Option<unsafe extern "C" fn(${params}) -> ${generateRustType(type.returnType, null)}>`;
  }
  if (type.type === "named" && type.name === "void") {
    if (parent?.type === "pointer") return "core::ffi::c_void";
    if (!parent) return "()";
    throwError(type.position, "void must have a pointer parent or no parent");
  }
  if (type.type === "named") {
    if (bannedTypes[type.name]) {
      appendError(type.position, bannedTypes[type.name]);
    }
    const t = rustSharedTypes[type.name];
    if (t) return t;
    // Unknown opaque — only valid behind a pointer (the per-type shim casts the
    // pointee). Behind a pointer we degrade to c_void; in by-value position that
    // would emit `-> core::ffi::c_void` (a ZST in Rust → silent ABI corruption),
    // so fail loudly at the C++ source location.
    if (parent?.type === "pointer") return "core::ffi::c_void";
    throwError(
      type.position,
      `unmapped C++ type '${type.name}' in by-value position; add to rustSharedTypes or pass by pointer`,
    );
  }
  assertNever(type);
}

function isGlobalObjectPtr(t: CppType): boolean {
  return (
    t.type === "pointer" &&
    t.child.type === "named" &&
    (t.child.name === "JSC::JSGlobalObject" || t.child.name === "Zig::GlobalObject")
  );
}

// C++ named types that map to opaque ZST handles in `bun_jsc`
// (`#[repr(C)] struct X { _p: UnsafeCell<[u8; 0]> }`). A `&X` covers zero
// Rust-visible bytes, so passing it to C++ that mutates the underlying GC
// cell never violates Stacked Borrows — these can always be lifted from
// `*mut X` to `&X` in wrapper signatures, mirroring the existing
// `JSGlobalObject*` → `&JSGlobalObject` rule.
const rustOpaqueHandles = new Set([
  "JSC::JSGlobalObject",
  "Zig::GlobalObject",
  "JSC::VM",
  "JSC::JSPromise",
  "JSC::JSInternalPromise",
  "JSC::JSMap",
  "JSC::JSObject",
  "JSC::JSString",
  "JSC::Exception",
  "JSC::CallFrame",
  "JSC::CustomGetterSetter",
  "JSC::SourceProvider",
  "WebCore::DOMURL",
]);

function opaqueHandleRustType(t: CppType): string | null {
  if (t.type !== "pointer" || t.child.type !== "named") return null;
  if (!rustOpaqueHandles.has(t.child.name)) return null;
  return rustSharedTypes[t.child.name] ?? null;
}

function generateRustFn(fn: CppFn, rustRaw: string[], rustWrap: string[]): void {
  const ret = generateRustType(fn.returnType, null);
  const rawParams = fn.parameters.map(p => `${rustIdent(p.name)}: ${generateRustType(p.type, null)}`).join(", ");
  rustRaw.push(`    pub fn ${fn.name}(${rawParams})${ret === "()" ? "" : ` -> ${ret}`};`);

  // Compute wrapper parameter list: opaque-ZST handle pointers become `&T`;
  // everything else passes through verbatim. The wrapper is `pub fn` (safe)
  // iff no raw pointer survives — otherwise the caller is still responsible
  // for the pointer's validity invariants and the wrapper stays `unsafe fn`.
  let needsUnsafe = false;
  const wrapParams: string[] = [];
  const callArgs: string[] = [];
  for (const p of fn.parameters) {
    const ident = rustIdent(p.name);
    const handle = opaqueHandleRustType(p.type);
    if (handle) {
      wrapParams.push(`${ident}: &${handle}`);
      callArgs.push(
        p.type.type === "pointer" && p.type.isConst
          ? `core::ptr::from_ref(${ident})`
          : `core::ptr::from_ref(${ident}).cast_mut()`,
      );
    } else if (p.type.type === "pointer" || p.type.type === "fn") {
      needsUnsafe = true;
      wrapParams.push(`${ident}: ${generateRustType(p.type, null)}`);
      callArgs.push(ident);
    } else {
      wrapParams.push(`${ident}: ${generateRustType(p.type, null)}`);
      callArgs.push(ident);
    }
  }
  const safeKw = needsUnsafe ? "unsafe " : "";
  const wrapParamsStr = wrapParams.join(", ");
  const callArgsStr = callArgs.join(", ");

  if (fn.tag === "nothrow") {
    // No scope needed. If every param is by-value or `&OpaqueHandle`, emit a
    // safe `pub fn`; otherwise the raw extern is already an `unsafe fn` with
    // the right signature, so re-export it directly.
    if (needsUnsafe) {
      rustWrap.push(`pub use self::raw::${fn.name};`);
    } else {
      rustWrap.push(
        `#[inline]`,
        `pub fn ${fn.name}(${wrapParamsStr})${ret === "()" ? "" : ` -> ${ret}`} {`,
        `    // SAFETY: \`[[ZIG_EXPORT(nothrow)]]\` extern; ref args are opaque-ZST handles valid for the call.`,
        `    unsafe { raw::${fn.name}(${callArgsStr}) }`,
        `}`,
      );
    }
    return;
  }

  const globalArg = fn.parameters.find(p => isGlobalObjectPtr(p.type));
  if (!globalArg) {
    appendError(fn.position, `no JSGlobalObject* parameter found (required for ZIG_EXPORT(${fn.tag}))`);
    rustWrap.push(`// skipped ${fn.name}: ${fn.tag} requires a JSGlobalObject* parameter`);
    return;
  }
  const gname = rustIdent(globalArg.name);

  if (fn.tag === "zero_is_throw" && ret !== "crate::JSValue") {
    appendError(fn.position, "ZIG_EXPORT(zero_is_throw) is only allowed for functions that return JSValue");
  } else if (fn.tag === "false_is_throw" && ret !== "bool") {
    appendError(fn.position, "ZIG_EXPORT(false_is_throw) is only allowed for functions that return bool");
  } else if (fn.tag === "null_is_throw" && fn.returnType.type !== "pointer") {
    appendError(fn.position, "ZIG_EXPORT(null_is_throw) is only allowed for functions that return a pointer");
  } else if (fn.tag === "check_slow" && ret === "crate::JSValue") {
    appendError(
      fn.position,
      "Use ZIG_EXPORT(zero_is_throw) instead of ZIG_EXPORT(check_slow) for functions that return JSValue",
    );
  }

  if (fn.tag === "check_slow") {
    // Inline the `top_scope!` body (rather than the `call_check_slow` *function* form,
    // which routes `SourceLocation::from_caller()` → thread-local intern probe per call
    // in debug builds). This is the highest-volume mode — keep it as cheap as the
    // zero/false/null arms below. `src!()` resolves to the wrapper file/line;
    // `#[track_caller]` would be a no-op
    // against a syntactic `file!()`, so don't emit it.
    rustWrap.push(
      `#[inline]`,
      `pub ${safeKw}fn ${fn.name}(${wrapParamsStr}) -> crate::JsResult<${ret}> {`,
      `    crate::top_scope!(__scope, ${gname});`,
      `    // SAFETY: \`[[ZIG_EXPORT(check_slow)]]\` extern; ref args are opaque-ZST handles valid for the call;`,
      `    // any raw-pointer args are forwarded under the wrapper's own \`unsafe fn\` contract.`,
      `    let __r = unsafe { raw::${fn.name}(${callArgsStr}) };`,
      `    __scope.return_if_exception()?;`,
      `    Ok(__r)`,
      `}`,
    );
    return;
  }

  let okExpr: string;
  let errCond: string;
  let okType: string;
  if (fn.tag === "zero_is_throw") {
    errCond = `__v == crate::JSValue::ZERO`;
    okExpr = `__v`;
    okType = `crate::JSValue`;
  } else if (fn.tag === "false_is_throw") {
    errCond = `!__v`;
    okExpr = `()`;
    okType = `()`;
  } else if (fn.tag === "null_is_throw") {
    errCond = `__v.is_null()`;
    okExpr =
      `\n        // SAFETY: \`__v.is_null()\` checked in the branch above.\n` +
      `        unsafe { core::ptr::NonNull::new_unchecked(__v) }`;
    okType = `core::ptr::NonNull<${generateRustType((fn.returnType as CppType & { type: "pointer" }).child, fn.returnType)}>`;
  } else assertNever(fn.tag);

  // `validation_scope!` expands `src!()` syntactically (resolves to this generated
  // file/line). `#[track_caller]`
  // can't influence a compile-time `file!()`, so don't emit it.
  rustWrap.push(
    `#[inline]`,
    `pub ${safeKw}fn ${fn.name}(${wrapParamsStr}) -> crate::JsResult<${okType}> {`,
    `    crate::validation_scope!(__scope, ${gname});`,
    `    // SAFETY: \`[[ZIG_EXPORT(${fn.tag})]]\` extern; ref args are opaque-ZST handles valid for the call;`,
    `    // any raw-pointer args are forwarded under the wrapper's own \`unsafe fn\` contract.`,
    `    let __v = unsafe { raw::${fn.name}(${callArgsStr}) };`,
    `    __scope.assert_exception_presence_matches(${errCond});`,
    `    if ${errCond} { Err(crate::JsError::Thrown) } else { Ok(${okExpr}) }`,
    `}`,
  );
}

function closest(node: SyntaxNode | null, type: string): SyntaxNode | null {
  while (node) {
    if (node.name === type) return node;
    node = node.parent;
  }
  return null;
}

type CppParser = typeof cppParser;

async function processFile(parser: CppParser, file: string, allFunctions: CppFn[]) {
  const sourceCode = await readFile(file, "utf8");
  if (!sourceCode.includes("[[ZIG_EXPORT(")) return;

  const sourceCodeLines = sourceCode.split("\n");
  const manualFindLines = new Set<number>();
  for (let i = 0; i < sourceCodeLines.length; i++) {
    if (sourceCodeLines[i].includes("[[ZIG_EXPORT(")) {
      manualFindLines.add(i + 1);
    }
  }

  const tree = parser.parse(sourceCode);
  const lineInfo = new LineInfo(sourceCode);
  const ctx: ParseContext = { file, sourceCode, lineInfo };

  if (!tree) {
    appendError({ file, start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }, "no tree found");
    for (const lineNumber of manualFindLines) {
      const lineContent = sourceCodeLines[lineNumber - 1];
      const column = lineContent.indexOf("[[ZIG_EXPORT(") + 3;
      appendError(
        {
          file,
          start: { line: lineNumber, column },
          end: { line: lineNumber, column: column + "ZIG_EXPORT(".length },
        },
        "ZIG_EXPORT found, but Lezer failed to parse the file.",
      );
    }
    return;
  }

  const queryFoundLines = new Set<number>();

  tree.iterate({
    enter: nodeRef => {
      if (nodeRef.name !== "FunctionDefinition") {
        return true; // Continue traversal
      }
      // console.log(
      //   `\n--- Found ZIG_EXPORT on function in ${file} at line ${lineInfo.get(nodeRef.node.from).line} ---\n`,
      // );
      // // Use the new pretty-printer to log the tree structure of the matched function
      // console.log(prettyPrintLezerNode(nodeRef.node, ctx.sourceCode));
      // console.log(`-------------------------------------------------------------------\n`);

      const fnNode = nodeRef.node;
      let zigExportAttr: SyntaxNode | null = null;
      let tagIdentifier: SyntaxNode | null = null;

      for (const attr of fnNode.getChildren("Attribute")) {
        const attrNameNode = attr.getChild("AttributeName");
        if (attrNameNode && text(attrNameNode, ctx) === "ZIG_EXPORT") {
          zigExportAttr = attr;
          const args = attr.getChild("AttributeArgs");
          if (args) {
            tagIdentifier = args.getChild("Identifier");
          }
          break;
        }
      }

      if (!zigExportAttr || !tagIdentifier) {
        return false; // Not an exported function, prune search
      }

      queryFoundLines.add(lineInfo.get(zigExportAttr.from).line);

      // disabled because lezer parses (extern "C") separately to the function definition / block
      /* const linkage = closest(fnNode, "LinkageSpecification");
      const linkageString = linkage?.getChild("String");
      if (!linkage || !linkageString || text(linkageString, ctx) !== '"C"') {
        appendError(
          nodePosition(fnNode, ctx),
          'exported function must be extern "C":\n' +
            (linkage ? prettyPrintLezerNode(linkage, ctx.sourceCode) : "no linkage"),
        );
      } */

      const tagStr = text(tagIdentifier, ctx);
      let tag: ExportTag | undefined;
      if (
        tagStr === "nothrow" ||
        tagStr === "zero_is_throw" ||
        tagStr === "check_slow" ||
        tagStr === "false_is_throw" ||
        tagStr === "null_is_throw"
      ) {
        tag = tagStr;
      } else if (tagStr === "print") {
        console.log(prettyPrintLezerNode(fnNode, ctx.sourceCode));
        appendError(nodePosition(tagIdentifier, ctx), "'print' tags are only for debugging cppbind");
        tag = "nothrow";
      } else {
        appendError(
          nodePosition(tagIdentifier, ctx),
          "tag must be nothrow, zero_is_throw, check_slow, false_is_throw, or null_is_throw: " + tagStr,
        );
        tag = "nothrow";
      }

      try {
        const result = processFunction(ctx, fnNode, tag);
        allFunctions.push(result);
      } catch (e) {
        appendErrorFromCatch(e, nodePosition(fnNode, ctx));
      }

      return false; // Don't descend into function body
    },
  });

  for (const lineNumber of manualFindLines) {
    if (!queryFoundLines.has(lineNumber)) {
      const lineContent = sourceCodeLines[lineNumber - 1];
      const column = lineContent.indexOf("[[ZIG_EXPORT(") + 3;
      const position: Srcloc = {
        file,
        start: { line: lineNumber, column },
        end: { line: lineNumber, column: column + "ZIG_EXPORT(".length },
      };
      appendError(
        position,
        "ZIG_EXPORT was found on this line, but the Lezer parser did not find a valid C++ attribute on a function definition. Ensure it's in the form `[[ZIG_EXPORT(tag)]]` before a function definition.",
      );
    }
  }
}

async function renderError(position: Srcloc, message: string, label: string, color: string) {
  const fileContent = await readFile(position.file, "utf8");
  const lines = fileContent.split("\n");
  const line = lines[position.start.line - 1];
  if (line === undefined) return;

  console.error(
    `\x1b[m${position.file}:${position.start.line}:${position.start.column}: ${color}\x1b[1m${label}:\x1b[m ${message}`,
  );
  const before = `${position.start.line} |   ${line.substring(0, position.start.column - 1)}`;
  const after = line.substring(position.start.column - 1);
  console.error(`\x1b[90m${before}${after}\x1b[m`);
  let length = position.start.line === position.end.line ? position.end.column - position.start.column : 1;
  console.error(`\x1b[m${" ".repeat(stringWidth(before))}${color}^${"~".repeat(Math.max(length - 1, 0))}\x1b[m`);
}

type Cfg = {
  dstDir: string;
};
async function readFileOrEmpty(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (e) {
    return "";
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dstDir = args[1];
  if (!dstDir) {
    console.error(
      String.raw`
                   _     _           _
                  | |   (_)         | |
   ___ _ __  _ __ | |__  _ _ __   __| |
  / __| '_ \| '_ \| '_ \| | '_ \ / _' |
 | (__| |_) | |_) | |_) | | | | | (_| |
  \___| .__/| .__/|_.__/|_|_| |_|\__,_|
      | |   | |
      |_|   |_|
`.slice(1),
    );
    console.error("Usage: bun src/codegen/cppbind src build/debug/codegen [cxx-sources.txt]");
    process.exit(1);
  }
  await mkdir(dstDir, { recursive: true });

  const parser = cppParser;

  // Source list: build system globs and passes the path (see
  // scripts/build/codegen.ts emitCppBind). For ad-hoc runs:
  //   bun scripts/glob-sources.ts cxx > /tmp/cxx.txt
  //   bun src/codegen/cppbind.ts <codegen> <out> /tmp/cxx.txt
  const cxxSourcesPath = args[2];
  if (!cxxSourcesPath) {
    console.error("usage: cppbind.ts <codegen-dir> <output> <cxx-sources-file>");
    process.exit(1);
  }
  const allCppFiles = (await readFile(cxxSourcesPath, "utf8"))
    .trim()
    .split("\n")
    .map(q => q.trim())
    .filter(q => !!q)
    .filter(q => !q.startsWith("#"));

  const allFunctions: CppFn[] = [];
  await Promise.all(allCppFiles.map(file => processFile(parser, file, allFunctions)));
  allFunctions.sort((a, b) => (a.position.file < b.position.file ? -1 : a.position.file > b.position.file ? 1 : 0));

  const rustRaw: string[] = [];
  const rustWrap: string[] = [];
  for (const fn of allFunctions) {
    try {
      generateRustFn(fn, rustRaw, rustWrap);
    } catch (e) {
      appendErrorFromCatch(e, fn.position);
    }
  }

  for (const message of errors) {
    await renderError(message.position, message.message, "error", "\x1b[31m");
    for (const note of message.notes) {
      await renderError(note.position, note.message, "note", "\x1b[36m");
    }
    console.error();
  }

  const rustFilePath = join(dstDir, "cpp.rs");
  const rustContents =
    "// generated by cppbind.ts from functions marked with [[ZIG_EXPORT(mode)]]\n" +
    "// `include!`d by `bun_jsc::cpp` — see src/jsc/cpp.rs for the wrapper module docs.\n\n" +
    'unsafe extern "C" {}\n' + // ensure the file parses even with zero exports
    "pub mod raw {\n" +
    "    #[allow(unused_imports)] use super::*;\n" +
    '    unsafe extern "C" {\n' +
    rustRaw.join("\n") +
    "\n    }\n}\n\n" +
    rustWrap.join("\n") +
    "\n";
  if ((await readFileOrEmpty(rustFilePath)) !== rustContents) {
    await writeFile(rustFilePath, rustContents);
  }

  if (process.env.CI) {
    const now = Date.now();
    console.log(
      (errors.length > 0 ? "✗" : "✓") +
        " cppbind.ts generated bindings to " +
        rustFilePath +
        (errors.length > 0 ? " with errors" : "") +
        " in " +
        (now - start) +
        "ms",
    );
  }

  if (errors.length > 0) {
    process.exit(1);
  }
}

// Run the main function
await main();
