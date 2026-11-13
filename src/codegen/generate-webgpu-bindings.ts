/**
 * Writes src/runtime/webgpu/webgpu.bind.ts and packages/bun-types/webgpu.d.ts from src/runtime/webgpu/webgpu.idl,
 * which is `ed/idl/webgpu.idl` of https://github.com/w3c/webref. Run it after replacing that file, or changing this one:
 *
 *   bun src/codegen/generate-webgpu-bindings.ts
 *
 * The tables say what the IDL does not: what Bun leaves out, and what the Rust functions need.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Argument, type Definition, type IDLType, type Member, parseWebIDL } from "./webidl.ts";

const repo = join(import.meta.dirname, "..", "..");
const schemaPath = join(repo, "src", "runtime", "webgpu", "webgpu.bind.ts");
const typesPath = join(repo, "packages", "bun-types", "webgpu.d.ts");

/** What needs a window or a DOM. The types that only these name go with them. */
const leftOut = new Set([
  "GPUCanvasContext",
  "GPUDevice.importExternalTexture",
  "GPUQueue.copyExternalImageToTexture",
  // Nothing makes one. `instanceof` needs the interface, and a view is bound where one would be.
  "GPUBindingResource.GPUExternalTexture",
]);

/** The body makes an exception, and has the heap to make it in. */
const throws = new Set([
  "GPUBuffer.getMappedRange",
  "GPUCommandEncoder.beginRenderPass",
  "GPUCommandEncoder.copyBufferToTexture",
  "GPUCommandEncoder.copyTextureToBuffer",
  "GPUCommandEncoder.copyTextureToTexture",
  "GPUDevice.createBindGroupLayout",
  "GPUDevice.createBuffer",
  "GPUDevice.createQuerySet",
  "GPUDevice.createRenderBundleEncoder",
  "GPUDevice.createRenderPipeline",
  "GPUDevice.createTexture",
  "GPUQueue.writeBuffer",
  "GPUQueue.writeTexture",
  "GPURenderPassEncoder.setBlendConstant",
  "GPUTexture.createView",
  "GPUUncapturedErrorEvent.constructor",
  "set_bind_group_with_data",
  "setImmediates",
]);

/** It detaches what `getMappedRange()` returned, and rejects a promise. */
const detaches = new Set(["GPUBuffer.destroy", "GPUBuffer.unmap", "GPUDevice.destroy"]);

const overloads: Record<string, string[]> = {
  copyBufferToBuffer: ["copy_buffer_to_buffer", "copy_buffer_to_buffer_at"],
  setBindGroup: ["set_bind_group", "set_bind_group_with_data"],
};

/** Strings that Dawn reads during the call, and nothing keeps. An unpaired surrogate becomes U+FFFD, as in a `USVString`. */
const utf8 = new Set([
  "code",
  "featureLevel",
  "groupLabel",
  "markerLabel",
  "swizzle",
  "GPUProgrammableStage.entryPoint",
]);

/** For a union that the IDL does not name. */
const unions: Record<string, [name: string, ...alternatives: string[]]> = {
  "GPUPipelineLayout or GPUAutoLayoutMode": ["GPUPipelineLayoutOrAuto", "layout", "automatic"],
  "GPUTexture or GPUTextureView": ["GPUTextureOrView", "texture", "view"],
};

/** Its methods can make errors, so it holds the `GPUDevice`, which has the listeners. */
const holdsDevice = { internalFields: ["device"] };
const classOptions: Record<string, object> = {
  GPUBuffer: { ...holdsDevice, estimatedSize: true },
  GPUCommandEncoder: holdsDevice,
  GPUComputePassEncoder: holdsDevice,
  GPUComputePipeline: holdsDevice,
  GPUError: { final: false },
  GPUExternalTexture: { refCounted: false },
  GPUQueue: holdsDevice,
  GPURenderBundleEncoder: holdsDevice,
  GPURenderPassEncoder: holdsDevice,
  GPURenderPipeline: holdsDevice,
  GPUTexture: { ...holdsDevice, estimatedSize: true },
};

/** An attribute that is a JS value which the object holds from the start. */
const held = new Set(["GPUCompilationInfo.messages", "GPUUncapturedErrorEvent.error"]);

const ofOtherSpecifications = `
dictionary EventInit {
  boolean bubbles = false;
  boolean cancelable = false;
  boolean composed = false;
};`;

const prologue = `// Written by src/codegen/generate-webgpu-bindings.ts, from webgpu.idl.

import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::webgpu" });

const promiseOf = (value: table.TableType) =>
  b.any.returning(table.instance("Promise").holding({ value, reason: table.any }).spec);
const typesOf = (name: string) => [
  table.viewType(name),
  table.viewType(\`bun.WebGPU.\${name}\`),
  table.exactType(\`$Bindgen.\${name}\`),
];
/** The call is done with the bytes when it returns. */
const copied = [table.readsContents()];
/** What a device makes in a later turn of the event loop, for a listener or a promise. */
const madeByDevice = [
  "GPUDeviceLostInfo",
  "GPUInternalError",
  "GPUOutOfMemoryError",
  "GPUPipelineError",
  "GPUUncapturedErrorEvent",
  "GPUValidationError",
].map(name => table.createdIn(table.instance(name), table.nativeMemory));

const iteratorOver = (element: table.TableType) =>
  ({
    returns: b.any.returning(table.instance("SetIterator").holding({ element }).spec),
    capability: "heap",
    passThis: true,
  }) as const;
const setlike = {
  size: { getter: b.u32 },
  has: { args: { value: b.string.loose }, returns: b.bool },
  entries: iteratorOver(table.instance("Array").holding({ element: table.string })),
  keys: iteratorOver(table.string),
  values: iteratorOver(table.string),
  forEach: { args: { callback: b.callable, thisArg: b.any }, capability: "js", throws: true, passThis: true, length: 1 },
  "@@iterator": { ...iteratorOver(table.string), rustName: "values" },
} as const;
`;

const epilogue = `
/** For \`bun:internal-for-testing\`. */
export const useNullBackendForTesting = b.fn({ args: { useIt: b.bool } });
/** Whether Dawn has said that the device of \`queue\` is lost, which JavaScript only hears from the \`GPUDevice\`. */
export const isDeviceLostForTesting = b.fn({ args: { queue: GPUQueue }, returns: b.bool });

/** \`navigator.gpu\`, for ZigGlobalObject.cpp. */
export const createGPU = b.value({ returns: GPU, capability: "heap" });
`;

const integers: Record<string, string> = {
  "unsigned short": "b.u16",
  "unsigned long": "b.u32",
  "unsigned long long": "b.u64",
  "long": "b.i32",
};

const object = (fields: Array<string | false>) => `{ ${fields.filter(Boolean).join(", ")} }`;
const lowerFirst = (name: string) => name[0]!.toLowerCase() + name.slice(1);

function readIDL(): Map<string, Definition> {
  return parseWebIDL(readFileSync(join(schemaPath, "..", "webgpu.idl"), "utf8") + ofOtherSpecifications);
}

function generateSchema(): string {
  const idl = readIDL();
  const written = new Map<string, string>();
  const unused = new Set([...leftOut, ...throws, ...detaches, ...utf8, ...held]);
  /** Whether `table` has one of `keys`. */
  const isIn = (table: Set<string>, ...keys: string[]) => {
    const key = keys.find(key => table.has(key));
    if (key !== undefined) unused.delete(key);
    return key !== undefined;
  };

  /** After what it names, which `make` defines. */
  function define(name: string, make: () => string, isExported = true): string {
    if (!written.has(name)) {
      const text = make();
      written.set(name, `${isExported ? "export " : ""}const ${name} = ${text};`);
    }
    return name;
  }

  const kindOf = (type: IDLType): string => {
    const definition = type.kind === "name" ? idl.get(type.name) : undefined;
    return definition?.kind === "typedef" ? kindOf(definition.type) : (definition?.kind ?? type.kind);
  };

  /** `isArgument`: its slot in the frame keeps an object alive. Anywhere else Rust takes a reference. */
  function accepted(type: IDLType, isArgument = false): string {
    return acceptedNotNull(type, isArgument) + (type.nullable ? ".nullable" : "");
  }

  function acceptedNotNull(type: IDLType, isArgument: boolean): string {
    if (type.kind === "generic") return `b.${type.name}(${accepted(type.of.at(-1)!)})`;
    if (type.kind === "union") {
      const names = type.of.map(alternative => (alternative as { name: string }).name);
      if (names[1] === "undefined") return `${accepted(type.of[0]!)}.optional`;
      const [name, ...alternatives] = unions[names.join(" or ")]!;
      return define(name, () => `b.union(${object(type.of.map((of, i) => `${alternatives[i]}: ${accepted(of)}`))})`);
    }
    const integer = integers[type.name];
    if (integer) {
      if (type.attributes.includes("EnforceRange")) return `${integer}.enforceRange()`;
      return `${integer}.${type.attributes.includes("Clamp") ? "clamp" : "wrap"}`;
    }
    switch (type.name) {
      case "boolean":
        return "b.bool.loose";
      case "float":
        return "b.f32";
      case "double":
        return "b.f64.loose.finite";
      case "DOMString":
        return isArgument ? "b.string.loose.owned" : "b.string.loose";
      case "USVString":
        return "b.string.usv";
      // The body checks that it is one.
      case "Uint32Array":
      case "AllowSharedBufferSource":
        return "b.bufferSource.allowShared";
      case "GPUError":
        return "b.any";
    }
    const definition = idl.get(type.name);
    if (!definition) throw new Error(`${type.name}: no such type`);
    defineNamed(definition);
    return definition.kind === "interface" && !isArgument ? `${type.name}.ref` : type.name;
  }

  function returned(type: IDLType): string {
    if (type.kind === "generic") {
      const [value] = type.of as [Extract<IDLType, { kind: "name" }>];
      if (value.name === "undefined") return "promiseOf(table.undefined)";
      const instance = `table.instance("${defineNamed(idl.get(value.name)!)}")`;
      return `promiseOf(${instance}${value.nullable ? ".or(table.strictNull)" : ""})`;
    }
    if (type.kind === "union") return `${returned(type.of[0]!)}.optional`;
    const definition = idl.get(type.name);
    if (definition?.kind === "typedef") return returned(definition.type);
    if (definition) return defineNamed(definition);
    if (type.name === "ArrayBuffer") return `b.any.returning("ArrayBuffer")`;
    return integers[type.name] ?? { boolean: "b.bool", DOMString: "b.string", USVString: "b.string.usv" }[type.name]!;
  }

  function argument(owner: string, { name, type, optional, default: value }: Argument, isArgument: boolean): string {
    const text = isIn(utf8, name, `${owner}.${name}`) ? "b.string.loose.utf8" : accepted(type, isArgument);
    // A union has no default in bindgen. Rust knows what this one is.
    if (value === "{}" && kindOf(type) === "union") return `${name}: ${text}.optional`;
    if (value !== undefined) return `${name}: ${text}.default(${value})`;
    return `${name}: ${text}${optional ? ".optional" : ""}`;
  }

  const argumentsOf = (owner: string, args: Argument[]) =>
    args.length > 0 && `args: ${object(args.map(arg => argument(owner, arg, true)))}`;

  function operation(owner: string, member: Extract<Member, { kind: "operation" }>, rustName?: string): string {
    const keys = [`${owner}.${member.name}`, rustName ?? member.name];
    const { returns } = member;
    const isVoid = returns.kind === "name" && returns.name === "undefined";
    const isAsync = returns.kind === "generic";
    const doesThrow = isIn(throws, ...keys);
    const runsJS = isAsync || isIn(detaches, ...keys);
    const buffers = member.args.filter(({ type }) => accepted(type, true).startsWith("b.bufferSource"));
    return object([
      !!rustName && `rustName: "${rustName}"`,
      argumentsOf(owner, member.args),
      !isVoid && `returns: ${returned(returns)}`,
      runsJS ? `capability: "js"` : (doesThrow || kindOf(returns) === "interface") && `capability: "heap"`,
      (runsJS || doesThrow) && "throws: true",
      isAsync && "rejects: true",
      buffers.length > 0 && `uses: ${object(buffers.map(({ name }) => `${name}: copied`))}`,
      member.name === "requestDevice" && "uses: { this: [table.retained, ...madeByDevice] }",
    ]);
  }

  function attribute(owner: string, member: Extract<Member, { kind: "attribute" }>): string {
    const { name, type } = member;
    if (isIn(held, `${owner}.${name}`)) return `{ internalField: "${name}" }`;
    if (type.kind === "name" && type.name === "EventHandler") return `{ eventHandler: "${name.slice(2)}" }`;
    const getter = `getter: ${returned(type)}`;
    if (type.kind === "generic") return object([getter, "cache: true", `capability: "js"`]);
    if (member.attributes.includes("SameObject")) return object([getter, "cache: true", `capability: "heap"`]);
    return object([getter, !member.readonly && "setter: true"]);
  }

  function classOf({ name, base, members }: Extract<Definition, { members: Member[] }>): string {
    const ours = base === undefined ? undefined : idl.get(base);
    const proto: string[] = [];
    const internalFields: string[] = [];
    let construct = `"illegal"`;
    for (const member of members) {
      if (member.kind === "setlike") {
        proto.push("...setlike");
        internalFields.push("set");
      } else if (member.kind === "constructor") {
        const doesThrow = isIn(throws, `${name}.constructor`);
        const snake = name.slice(3).replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
        construct = object([
          argumentsOf(name, member.args),
          !member.args[0]!.optional && `requiredArguments: ${member.args.length}`,
          !!ours && `rustName: "new${snake}"`,
          doesThrow && `passStructure: true, capability: "heap", throws: true`,
        ]);
      } else if (member.kind === "attribute") {
        if (held.has(`${name}.${member.name}`)) internalFields.push(member.name);
        proto.push(`${member.name}: ${attribute(name, member)}`);
      } else if (member.kind === "operation" && !isIn(leftOut, `${name}.${member.name}`)) {
        const same = members.filter(other => other.kind === "operation" && other.name === member.name);
        if (same.length === 1) proto.push(`${member.name}: ${operation(name, member)}`);
        else if (same[0] === member) {
          const all = same.map((each, i) => operation(name, each as typeof member, overloads[member.name]![i]));
          proto.push(`${member.name}: [${all.join(", ")}]`);
        }
      }
    }
    const isGPUObject = members.some(member => member.kind === "attribute" && member.name === "label");
    const options = {
      ...(!ours && { rustPath: `crate::webgpu::${name}` }),
      // The members of a WebIDL interface can be replaced, which shims and debuggers do.
      configurable: true,
      refCounted: isGPUObject || (!!base && !ours),
      ...(base && !ours && { webcoreBase: base }),
      ...(internalFields.length > 0 && { internalFields }),
      ...classOptions[name],
    };
    return `b.class(${object([
      !!ours && `extends: ${defineNamed(ours)}`,
      `types: typesOf("${name}")`,
      ...Object.entries(options).map(
        ([key, value]) => (value || key === "final") && `${key}: ${JSON.stringify(value)}`,
      ),
      `construct: ${construct}`,
      `proto: ${object(proto)}`,
    ])})`;
  }

  /** In the order that WebIDL reads them: lexicographical, after those of the dictionary it inherits from. */
  function membersOf(name: string): Array<[owner: string, member: Argument]> {
    const { base, members } = idl.get(name) as Extract<Definition, { kind: "dictionary" }>;
    const own = members.toSorted((a, b) => (a.name < b.name ? -1 : 1));
    return [...(base ? membersOf(base) : []), ...own.map(member => [name, member] as [string, Argument])];
  }

  function defineNamed(definition: Definition): string {
    const { name } = definition;
    switch (definition.kind) {
      case "enum":
        return define(name, () => {
          if (!definition.values.some(value => /^\d/.test(value))) {
            return `b.enumeration(${JSON.stringify(definition.values)})`;
          }
          // `2d-array` is `D2Array`.
          const variant = (value: string) =>
            value.replace(/^(\d)d/, "d$1").replace(/(?:^|-)(\w)/g, (_, letter) => letter.toUpperCase());
          return `b.enumeration(${object(definition.values.map(value => `${variant(value)}: "${value}"`))})`;
        });
      case "dictionary":
        return define(name, () => {
          const members = membersOf(name);
          return `b.dictionary(${object(members.map(([owner, member]) => argument(owner, member, false)))}, ${object([
            "allowArray: true",
            members.every(([, member]) => member.optional) && `nonObjectAsEmpty: "nullish"`,
          ])})`;
        });
      case "typedef": {
        const { type } = definition;
        if (type.kind !== "union") return define(name, () => accepted(type), false);
        return define(name, () => {
          const alternatives = type.of.flatMap(of => {
            const ofName = (of as { name: string }).name;
            if (isIn(leftOut, `${name}.${ofName}`)) return [];
            const key = ofName === `${name}Dict` ? "dict" : lowerFirst(ofName.replace(/^GPU/, ""));
            return `${key}: ${accepted(of)}`;
          });
          return `b.union(${object(alternatives)})`;
        });
      }
      case "namespace":
        return define(name, () => {
          const constants = definition.members.map(
            member => member.kind === "const" && `${member.name}: { constant: ${member.value} }`,
          );
          return `b.namespace(${object(constants)}, { toStringTag: true })`;
        });
      default:
        return define(name, () => classOf(definition));
    }
  }

  for (const definition of idl.values()) {
    const isGlobal = definition.kind === "interface" || definition.kind === "namespace";
    if (isGlobal && !isIn(leftOut, definition.name)) defineNamed(definition);
  }
  if (unused.size > 0) throw new Error(`The IDL has nothing that is called ${[...unused].join(", ")}`);
  return `${prologue}\n${[...written.values()].join("\n")}\n${epilogue}`;
}

const typesOfTS: Record<string, string> = {
  ...Object.fromEntries([...Object.keys(integers), "float", "double"].map(name => [name, "number"])),
  DOMString: "string",
  USVString: "string",
  AllowSharedBufferSource: "Bun.BufferSource",
  EventInit: "Bun.EventInit",
};

/**
 * TypeScript's `lib.dom.d.ts` and `@webgpu/types` declare the same names, and win. An interface can be declared twice
 * and a type alias cannot, so those are only in the namespace.
 */
function generateTypes(): string {
  const idl = readIDL();
  const written = new Map<string, string>();
  const globals: string[] = [];

  function type(of: IDLType, owner = ""): string {
    const text = notNull(of, owner);
    return of.nullable ? `${text} | null` : text;
  }

  function notNull(of: IDLType, owner: string): string {
    if (of.kind === "union") {
      return of.of
        .filter(each => !leftOut.has(`${owner}.${(each as { name: string }).name}`))
        .map(each => type(each))
        .join(" | ");
    }
    if (of.kind === "generic") {
      const element = type(of.of.at(-1)!);
      if (of.name === "record") return `Record<string, ${element}>`;
      return `${{ sequence: "Iterable", FrozenArray: "ReadonlyArray" }[of.name] ?? of.name}<${element}>`;
    }
    const definition = typesOfTS[of.name] ? undefined : idl.get(of.name);
    if (definition) declare(definition);
    return typesOfTS[of.name] ?? of.name;
  }

  /** TypeScript has nothing required after what is optional. */
  const parameters = (args: Argument[]) =>
    args
      .map(({ name, type: of, optional }, i) =>
        optional && args.slice(i).some(later => !later.optional)
          ? `${name}: ${type(of)} | undefined`
          : `${name}${optional ? "?" : ""}: ${type(of)}`,
      )
      .join(", ");

  function member(owner: string, of: Member): string[] {
    if (of.kind === "const") return [`readonly ${of.name}: number;`];
    if (of.kind === "operation" && !leftOut.has(`${owner}.${of.name}`)) {
      return [`${of.name}(${parameters(of.args)}): ${type(of.returns)};`];
    }
    if (of.kind !== "attribute") return [];
    if (of.name !== "onuncapturederror") return [`${of.readonly ? "readonly " : ""}${of.name}: ${type(of.type)};`];
    const listener = `(this: ${owner}, event: GPUUncapturedErrorEvent) => any`;
    return [
      `${of.name}: (${listener}) | null;`,
      `addEventListener(type: "uncapturederror", listener: ${listener}, options?: boolean | AddEventListenerOptions): void;`,
      `addEventListener(...args: Parameters<EventTarget["addEventListener"]>): void;`,
      `removeEventListener(type: "uncapturederror", listener: ${listener}, options?: boolean | EventListenerOptions): void;`,
      `removeEventListener(...args: Parameters<EventTarget["removeEventListener"]>): void;`,
    ];
  }

  function declare(definition: Definition): void {
    const { name } = definition;
    if (written.has(name)) return;
    written.set(name, "");
    if (definition.kind === "enum") {
      written.set(name, `type ${name} = ${definition.values.map(value => `"${value}"`).join(" | ")};`);
      return;
    }
    if (definition.kind === "typedef") {
      written.set(name, `type ${name} = ${type(definition.type, name)};`);
      return;
    }
    const isSet = definition.kind !== "dictionary" && definition.members.some(each => each.kind === "setlike");
    const base = isSet
      ? "ReadonlySet<string>"
      : definition.base && type({ kind: "name", name: definition.base, nullable: false, attributes: [] });
    const members =
      definition.kind === "dictionary"
        ? definition.members.map(
            each =>
              `${each.name}${each.optional ? "?" : ""}: ${type(each.type)}${each.optional ? " | undefined" : ""};`,
          )
        : definition.members.flatMap(each => member(name, each));
    written.set(name, `interface ${name} ${base ? `extends ${base} ` : ""}{\n${members.join("\n")}\n}`);
    const ours = `Bun.WebGPU.${name}`;
    const isInLibDom = definition.kind !== "namespace" && name !== "GPUShaderModuleCompilationHint";
    // `@webgpu/types` has an alias for what only inherits.
    const isGlobalType = !base || members.length > 0 || (definition.kind === "interface" && !isSet);
    if (isGlobalType)
      globals.push(`interface ${name} extends ${isInLibDom ? `Bun.__internal.LibEmptyOrWebGPU<${ours}>` : ours} {}`);
    if (definition.kind === "dictionary") return;
    if (definition.kind === "namespace") {
      globals.push(`declare var ${name}: ${name};`);
      return;
    }
    const constructor = definition.members.find(each => each.kind === "constructor");
    const construct = constructor ? `new (${parameters(constructor.args)}): ${name}` : "new (): never";
    globals.push(
      `declare var ${name}: Bun.__internal.UseLibDomWebGPUIfAvailable<"${name}", { prototype: ${isGlobalType ? name : ours}; ${construct} }>;`,
    );
  }

  for (const definition of idl.values()) {
    const isGlobal = definition.kind === "interface" || definition.kind === "namespace";
    if (isGlobal && !leftOut.has(definition.name)) declare(definition);
  }
  return `// Written by src/codegen/generate-webgpu-bindings.ts, from src/runtime/webgpu/webgpu.idl.

declare module "bun" {
namespace __internal {
/** \`lib.dom.d.ts\` or \`@webgpu/types\` is loaded. Both have \`GPUCanvasContext\`, which Bun does not. */
type LibEmptyOrWebGPU<T> = typeof globalThis extends { GPUCanvasContext: any } ? {} : T;
/** \`Otherwise\` is what \`@webgpu/types\` declares, which can come after this file and so cannot be inferred from. */
type UseLibDomWebGPUIfAvailable<Name extends PropertyKey, Otherwise> =
  typeof globalThis extends { GPUCanvasContext: { new (): infer Context } }
    ? [Context] extends [never] ? Otherwise : UseLibDomIfAvailable<Name, Otherwise>
    : Otherwise;
}

/**
 * [WebGPU](https://gpuweb.github.io/gpuweb/), without what needs a window or a DOM. The interfaces are globals too.
 */
namespace WebGPU {
${[...written.values()].join("\n")}
interface NavigatorGPU {
/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Navigator/gpu) */
readonly gpu: GPU;
}
}
}

${globals.join("\n")}
interface NavigatorGPU extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.NavigatorGPU> {}
interface Navigator extends NavigatorGPU {}
`;
}

/** By path, before prettier. */
export const generate = () => ({ [schemaPath]: generateSchema(), [typesPath]: generateTypes() });

if (import.meta.main) {
  const files = generate();
  for (const [path, text] of Object.entries(files)) writeFileSync(path, text);
  spawnSync(process.execPath, ["x", "prettier", "--write", ...Object.keys(files)], { cwd: repo, stdio: "inherit" });
}
