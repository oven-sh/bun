// Generates ../dom.d.ts, the types of "bun:dom".
//
// To regenerate, from the repository root, with the Bun whose bun:dom the types are to describe:
//
//   <that bun> packages/bun-types/scripts/generate-dom.ts --dump
//   bun fmt packages/bun-types/dom.d.ts packages/bun-types/scripts/dom-members.json
//
// --dump writes down what that Bun's bun:dom has at run time, in dom-members.json, and goes on
// to generate. Without it any Bun can generate from the dom-members.json that is there.
// --report prints what was left out and why.
//
// A project that loads TypeScript's lib.dom gets lib.dom's own type for every export.
// A project that does not gets declarations cut out of lib.dom.d.ts: the interfaces that
// bun:dom exports, with only the members they have at run time, and the dictionaries, type
// aliases and maps those members mention.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import ts from "typescript";

const packageRoot = join(import.meta.dir, "..");
const membersPath = join(import.meta.dir, "dom-members.json");

/** Lists of names are strings with spaces in between, which keeps the formatted file short. */
interface RuntimeInterface {
  /** The nearest export whose prototype is on this one's prototype chain. */
  extends?: string;
  /** Own property names of the export itself. */
  static: string;
  /** Own property names of its prototype. */
  prototype: string;
  /** Own property names of an instance, for the interfaces that have any. */
  instance?: string;
}

// What a window hands out from the global object it was made in. These keep Bun's own types.
const realmMembers = [
  "atob",
  "btoa",
  "clearInterval",
  "clearTimeout",
  "console",
  "crypto",
  "fetch",
  "performance",
  "queueMicrotask",
  "reportError",
  "setInterval",
  "setTimeout",
  "structuredClone",
];

if (process.argv.includes("--dump")) {
  const dom: Record<string, any> = await import("bun:dom");
  const names = Object.keys(dom)
    .filter(name => name !== "default")
    .sort();
  const window = new dom.Window({ url: "http://localhost/" });
  const instances: Record<string, object> = { Window: window, Location: window.location, Document: window.document };
  const keys = (object: object, skip: string[]) =>
    Reflect.ownKeys(object)
      .map(key => (typeof key === "symbol" ? `[${key.description}]` : key))
      .filter(key => !skip.includes(key))
      .join(" ");

  const members: Record<string, RuntimeInterface> = {};
  for (const name of names) {
    const prototype: object | undefined = typeof dom[name] === "function" ? dom[name].prototype : undefined;
    let parent: string | undefined;
    for (let object = prototype && Object.getPrototypeOf(prototype); object && !parent;) {
      parent = names.find(other => typeof dom[other] === "function" && dom[other].prototype === object);
      object = Object.getPrototypeOf(object);
    }
    members[name] = {
      extends: parent,
      static: keys(dom[name], ["length", "name", "prototype"]),
      prototype: prototype ? keys(prototype, ["constructor"]) : "",
      instance: instances[name] && keys(instances[name], []),
    };
  }
  for (const name of realmMembers) {
    if (!(name in window)) throw new Error(`a window has no "${name}"`);
  }
  writeFileSync(membersPath, JSON.stringify(members, null, 2) + "\n");
}

const report: string[] = [];

const runtime = new Map<string, { extends?: string; static: Set<string>; members: Set<string>; instance: string[] }>();
for (const [name, value] of Object.entries<RuntimeInterface>(JSON.parse(readFileSync(membersPath, "utf8")))) {
  const instance = value.instance?.split(" ") ?? [];
  runtime.set(name, {
    extends: value.extends,
    static: new Set(value.static.split(" ")),
    members: new Set([...value.prototype.split(" "), ...instance]),
    instance,
  });
}

function runtimeHas(interfaceName: string, member: string): boolean {
  // lib.dom.d.ts calls the object with the CSS properties a CSSStyleDeclaration nearly everywhere.
  if (interfaceName === "CSSStyleDeclaration") interfaceName = "CSSStyleProperties";
  for (let current = runtime.get(interfaceName); current; current = runtime.get(current.extends!)) {
    if (current.members.has(member)) return true;
  }
  return false;
}

// What bun-types declares already, in the global scope and as `Bun.X`. Those are not declared again:
// the classes are the same classes in bun:dom.
const bunGlobals = new Set<string>();
const bunModuleTypes = new Set<string>();
function collectDeclaredNames(statements: readonly ts.Statement[], names: Set<string>) {
  for (const statement of statements) {
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      names.add(statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const { name } of statement.declarationList.declarations) {
        if (ts.isIdentifier(name)) names.add(name.text);
      }
    } else if (ts.isModuleDeclaration(statement) && statement.name.text === "bun" && statement.body) {
      collectDeclaredNames((statement.body as ts.ModuleBlock).statements, bunModuleTypes);
    }
  }
}
for (const file of readdirSync(packageRoot)) {
  if (!file.endsWith(".d.ts") || file === "dom.d.ts") continue;
  const text = readFileSync(join(packageRoot, file), "utf8");
  collectDeclaredNames(ts.createSourceFile(file, text, ts.ScriptTarget.ESNext).statements, bunGlobals);
}
// A window's Navigator is another class than the runtime's, with more members.
bunGlobals.delete("Navigator");

const source = readFileSync(createRequire(import.meta.url).resolve("typescript/lib/lib.dom.d.ts"), "utf8");
const libDom = ts.createSourceFile("lib.dom.d.ts", source, ts.ScriptTarget.ESNext, true);
const license = source.slice(0, source.indexOf("*/") + 2);

const interfaces = new Map<string, ts.InterfaceDeclaration[]>();
const aliases = new Map<string, ts.TypeAliasDeclaration>();
const namespaces = new Map<string, ts.ModuleBlock>();
const constructors = new Map<string, ts.TypeLiteralNode>();
for (const statement of libDom.statements) {
  if (ts.isInterfaceDeclaration(statement)) {
    interfaces.set(statement.name.text, [...(interfaces.get(statement.name.text) ?? []), statement]);
  } else if (ts.isTypeAliasDeclaration(statement)) {
    aliases.set(statement.name.text, statement);
  } else if (ts.isModuleDeclaration(statement) && statement.body && ts.isModuleBlock(statement.body)) {
    namespaces.set(statement.name.text, statement.body);
  } else if (ts.isVariableStatement(statement)) {
    const [declaration] = statement.declarationList.declarations;
    if (declaration?.type && ts.isTypeLiteralNode(declaration.type)) {
      constructors.set(declaration.name.getText(), declaration.type);
    }
  }
}

function memberName(member: ts.NamedDeclaration): string | undefined {
  const name = member.name;
  if (!name) return undefined;
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : name.getText();
}

/** An interface with an interface object (`declare var X: { prototype: X }`), as opposed to a dictionary or a mixin. */
function isPlatformInterface(name: string): boolean {
  return constructors.get(name)?.members.some(member => memberName(member) === "prototype") ?? false;
}

function membersOf(name: string): ts.TypeElement[] {
  return (interfaces.get(name) ?? []).flatMap(declaration => [...declaration.members]);
}

function parentsOf(name: string): ts.ExpressionWithTypeArguments[] {
  return (interfaces.get(name) ?? []).flatMap(
    declaration => declaration.heritageClauses?.flatMap(clause => [...clause.types]) ?? [],
  );
}

// A mixin has no object of its own at run time. Its members are looked up on the exports that include it.
const mixinHosts = new Map<string, Set<string>>();
function addMixinHost(interfaceName: string, host: string) {
  for (const parent of parentsOf(interfaceName)) {
    const name = parent.expression.getText();
    if (!interfaces.has(name) || isPlatformInterface(name) || bunGlobals.has(name)) continue;
    if (!mixinHosts.has(name)) mixinHosts.set(name, new Set());
    mixinHosts.get(name)!.add(host);
    addMixinHost(name, host);
  }
}
for (const name of runtime.keys()) {
  if (!bunGlobals.has(name)) addMixinHost(name, name);
}

// A member that only some of a mixin's hosts have is declared on those hosts instead.
const hoistedMembers = new Map<string, ts.TypeElement[]>();
for (const [mixin, hosts] of mixinHosts) {
  for (const member of membersOf(mixin)) {
    const name = memberName(member);
    const present = [...hosts].filter(host => name !== undefined && runtimeHas(host, name));
    if (present.length === hosts.size) continue;
    for (const host of present) hoistedMembers.set(host, [...(hoistedMembers.get(host) ?? []), member]);
  }
}

/** The first sentence of a node's JSDoc comment and its `@deprecated` tag, on one line. */
function documentation(node: ts.Node, tagsOnly = false): string {
  const range = ts.getLeadingCommentRanges(source, node.getFullStart())?.at(-1);
  const comment = range ? source.slice(range.pos, range.end) : "";
  if (!comment.startsWith("/**")) return "";
  const lines = comment
    .slice(3, -2)
    .split("\n")
    .map(line => line.replace(/^\s*\*/, "").trim());
  const tags = lines.filter(line => line.startsWith("@"));
  const firstLine = lines.findIndex(line => line !== "");
  const paragraphEnd = lines.findIndex((line, index) => index > firstLine && (line === "" || line.startsWith("@")));
  const paragraph = lines.slice(firstLine, paragraphEnd === -1 ? undefined : paragraphEnd).join(" ");
  const sentence =
    tagsOnly || paragraph.startsWith("@") || paragraph.startsWith("[MDN Reference]")
      ? ""
      : (paragraph.match(/^.*?[.:](?=\s+[A-Z`*[]|$)/)?.[0] ?? paragraph);
  const text = [sentence, ...tags].filter(part => part !== "").join(" ");
  return text === "" ? "" : `/** ${text} */\n`;
}

/**
 * What stands in for an interface that bun:dom does not have.
 * For `SVGCircleElement` it is `SVGElement`, which is what such an element is at run time.
 * For `TouchEvent` it is `Event`: nothing can make one, so a "touchstart" is whatever the script dispatches.
 */
function nearestAncestor(name: string): string | null {
  const parent = parentsOf(name)
    .map(type => type.expression.getText())
    .find(parent => isPlatformInterface(parent) || bunGlobals.has(parent));
  if (!parent || parent === "EventTarget") return null;
  if (!runtime.has(parent)) return nearestAncestor(parent);
  return runtimeHas(parent, "stopPropagation") ? "Event" : parent;
}

// The names that the declaration being rendered refers to.
let references: string[] = [];
// Outside the namespace, a name that lives in it needs the prefix.
let prefix = "";

function attempt(render: () => string | null): string | null {
  const mark = references.length;
  const text = render();
  if (text === null) references.length = mark;
  return text;
}

// Interfaces that bun:dom never makes an object of, kept whole, as plain types. `ResizeObserverEntry`: nothing
// is ever resized, but the callback that would be told has to type-check.
const typeOnlyInterfaces = new Set<string>();

/** What to write for a name that lib.dom.d.ts mentions, or null if bun:dom has nothing of the kind. */
function resolveName(name: string, isLenient: boolean): string | null {
  const isDeclared = interfaces.has(name) || aliases.has(name);
  if (!isDeclared || bunGlobals.has(name)) return name;
  if (bunModuleTypes.has(name)) return `Bun.${name}`;
  const isAvailable =
    runtime.has(name) ||
    typeOnlyInterfaces.has(name) ||
    (aliases.has(name) ? renderDeclaration(name).text !== null : !isPlatformInterface(name));
  if (!isAvailable) {
    if (!isLenient) return null;
    const ancestor = nearestAncestor(name);
    if (ancestor) return resolveName(ancestor, false);
    typeOnlyInterfaces.add(name);
  }
  references.push(name);
  return prefix + name;
}

/**
 * The text of a node without the types bun:dom does not have, or null if nothing is left of it.
 * A missing type goes from a union. Anything else that mentions one goes as a whole.
 * With `isLenient` a missing type is replaced with its nearest ancestor that is there, or kept as a plain type.
 */
function render(node: ts.Node, isLenient = false): string | null {
  if (ts.isUnionTypeNode(node)) {
    const types = node.types.map(type => attempt(() => render(type, isLenient))).filter(text => text !== null);
    return types.length > 0 ? [...new Set(types)].join(" | ") : null;
  }
  if (ts.isTypeReferenceNode(node) || ts.isExpressionWithTypeArguments(node)) {
    const name = ts.isTypeReferenceNode(node) ? node.typeName : node.expression;
    if (!ts.isIdentifier(name)) {
      const [namespace = ""] = name.getText().split(".");
      return namespaces.has(namespace) && !bunGlobals.has(namespace) ? null : node.getText();
    }
    const resolved = resolveName(name.text, isLenient);
    if (resolved === null) return null;
    const typeArguments = node.typeArguments?.map(type => render(type, isLenient)) ?? [];
    if (typeArguments.includes(null)) return null;
    return typeArguments.length > 0 ? `${resolved}<${typeArguments.join(", ")}>` : resolved;
  }

  let text = "";
  let position = node.getStart();
  let isMissing = false;
  let areParametersCut = false;
  ts.forEachChild(node, child => {
    if (isMissing) return;
    let rendered: string | null;
    if (ts.isParameter(child)) {
      // What a callback is called with: an event is at least an `Event`, whatever its name.
      const isCallback = ts.isFunctionTypeNode(node) || ts.isCallSignatureDeclaration(node);
      rendered = areParametersCut ? null : attempt(() => render(child, isLenient || isCallback));
      if (rendered === null && (child.questionToken || child.dotDotDotToken)) {
        areParametersCut = true;
        position = child.end;
        return;
      }
    } else {
      rendered = render(child, isLenient);
    }
    if (rendered === null) {
      isMissing = true;
      return;
    }
    text += source.slice(position, child.getStart()) + rendered;
    position = child.end;
  });
  return isMissing ? null : text + source.slice(position, node.end);
}

function renderMembers(owner: string, members: Iterable<ts.NamedDeclaration>, has: (name: string) => boolean) {
  const rendered: string[] = [];
  for (const member of members) {
    const name = memberName(member);
    if (name !== undefined && !has(name)) {
      report.push(`not at run time: ${owner}.${name}`);
      continue;
    }
    const text = attempt(() => render(member, owner.endsWith("Map") || typeOnlyInterfaces.has(owner)));
    if (text === null) report.push(`needs a type bun:dom does not have: ${owner}: ${member.getText()}`);
    else rendered.push(documentation(member, owner === "CSSStyleProperties") + text);
  }
  return rendered;
}

function renderTypeParameters(declaration: ts.InterfaceDeclaration | ts.TypeAliasDeclaration): string {
  const parameters = declaration.typeParameters?.map(parameter => render(parameter)) ?? [];
  return parameters.length > 0 ? `<${parameters.join(", ")}>` : "";
}

const extraParents: Record<string, string[]> = {
  Window: [`Pick<typeof globalThis, ${realmMembers.map(name => JSON.stringify(name)).join(" | ")}>`],
};

const extraMembers: Record<string, () => string[]> = {
  // A window has every interface as a property, and the three constructors that go by another name.
  Window: () =>
    runtime
      .get("Window")!
      .instance.filter(name => exportedNames.has(name) || (constructors.has(name) && !isPlatformInterface(name)))
      .map(name => `${name}: ${exportedNames.has(name) ? `typeof ${name}` : renderConstructor(name)};`),
  // The lists are arrays of whatever the constructor was given. There is no Touch and no TouchList.
  TouchEvent: () => ["readonly changedTouches: any[];", "readonly targetTouches: any[];", "readonly touches: any[];"],
  TouchEventInit: () => [
    "changedTouches?: Iterable<any>;",
    "targetTouches?: Iterable<any>;",
    "touches?: Iterable<any>;",
  ],
};

interface Rendered {
  /** null: nothing is left of it. */
  text: string | null;
  references: string[];
}
const renderedDeclarations = new Map<string, Rendered>();

/** An interface or a type alias, as it goes into the namespace. */
function renderDeclaration(name: string): Rendered {
  const existing = renderedDeclarations.get(name);
  if (existing) return existing;
  // What a type alias that refers to itself finds.
  renderedDeclarations.set(name, { text: "", references: [] });

  const [outerReferences, outerPrefix] = [references, prefix];
  [references, prefix] = [[], ""];
  let text: string | null;
  const alias = aliases.get(name);
  if (alias) {
    const type = render(alias.type);
    text = type && `${documentation(alias)}type ${name}${renderTypeParameters(alias)} = ${type};\n`;
  } else {
    const hosts = runtime.has(name) && isPlatformInterface(name) ? [name] : [...(mixinHosts.get(name) ?? [])];
    const members = [
      ...renderMembers(name, [...membersOf(name), ...(hoistedMembers.get(name) ?? [])], member =>
        hosts.every(host => runtimeHas(host, member)),
      ),
      ...(extraMembers[name]?.() ?? []),
    ];
    const parents = parentsOf(name)
      .filter(parent => !isEmptyMixin(parent.expression.getText()))
      .map(parent => {
        const text = attempt(() => render(parent));
        const missing = runtime.has(name) ? missingInheritedMembers(name, parent.expression.getText()) : [];
        return text && missing.length > 0 ? `Omit<${text}, ${missing.join(" | ")}>` : text;
      })
      .filter(parent => parent !== null)
      .concat(extraParents[name] ?? []);
    const declaration = interfaces.get(name)![0]!;
    // The comment of an exported interface is on the export.
    const comment = runtime.has(name) ? "" : documentation(declaration);
    const heritage = parents.length > 0 ? ` extends ${parents.join(", ")}` : "";
    text =
      mixinHosts.has(name) && members.length === 0 && parents.length === 0
        ? null
        : `${comment}interface ${name}${renderTypeParameters(declaration)}${heritage} {\n${members.join("\n")}\n}\n`;
  }
  const rendered = { text, references };
  [references, prefix] = [outerReferences, outerPrefix];
  renderedDeclarations.set(name, rendered);
  return rendered;
}

/** What an export has at run time and another one, which extends it in lib.dom.d.ts, has not. */
function missingInheritedMembers(name: string, parent: string): string[] {
  if (!runtime.has(parent) || bunGlobals.has(parent)) return [];
  const inherited = new Set<string>();
  const collect = (interfaceName: string) => {
    for (const member of membersOf(interfaceName)) inherited.add(memberName(member) ?? "");
    for (const type of parentsOf(interfaceName)) collect(type.expression.getText());
  };
  collect(parent);
  return [...inherited]
    .filter(member => runtimeHas(parent, member) && !runtimeHas(name, member))
    .map(member => JSON.stringify(member));
}

/** A mixin none of whose members is there at run time. */
function isEmptyMixin(name: string): boolean {
  return mixinHosts.has(name) && renderDeclaration(name).text === null;
}

/** The type of an interface object. */
function renderConstructor(name: string): string {
  const statics = runtime.get(name)?.static;
  const members = renderMembers(
    `typeof ${name}`,
    constructors.get(name)!.members,
    member => member === "prototype" || !statics || statics.has(member),
  );
  return `{\n${members.join("\n")}\n}`;
}

function useLibDom(name: string, otherwise: string): string {
  return `Bun.__internal.UseLibDomIfAvailable<"${name}", ${otherwise}>`;
}

// The exports that cannot be taken from lib.dom.d.ts as they are. `null` stands for what the generator would write.
const handWritten: Record<string, { type: string | null; value: string | null }> = {
  Window: {
    type: `
      export interface WindowOptions {
        /**
         * The address of the window's document: \`location.href\`, \`document.URL\` and the base of relative URLs.
         * Its origin is what \`localStorage\`, \`sessionStorage\` and \`postMessage()\` go by.
         * It has to be an absolute URL. Nothing is fetched from it.
         *
         * @default "about:blank"
         */
        url?: string | URL;
      }

      /**
       * A window with an empty HTML document. It has no frame, no layout and loads nothing.
       *
       * @example
       * \`\`\`ts
       * import { Window } from "bun:dom";
       *
       * const window = new Window({ url: "https://example.com/" });
       * window.document.body.innerHTML = "<p>Hello</p>";
       * \`\`\`
       */
      export type Window = ${useLibDom("Window", "{ prototype: __internal.Window }")}["prototype"];`,
    value: "{ prototype: Window; new (options?: WindowOptions): Window & typeof globalThis }",
  },
  // Bun's global declaration has no parameters: without a DOM there is no form to pass.
  FormData: {
    type: "export type FormData = globalThis.FormData;",
    value: useLibDom(
      "FormData",
      "{ prototype: FormData; new (form?: HTMLFormElement, submitter?: HTMLElement | null): FormData }",
    ),
  },
  // Not an interface with a prototype, so lib.dom's type has to be found somewhere else.
  NodeFilter: { type: `export type NodeFilter = NonNullable<TreeWalker["filter"]>;`, value: null },
  ProgressEvent: {
    type: `export type ProgressEvent<T extends EventTarget = EventTarget> = Bun.__internal.LibDomIsLoaded extends true
      ? (typeof ProgressEvent)["prototype"] & { readonly target: T | null }
      : __internal.ProgressEvent<T>;`,
    value: null,
  },
  // lib.dom.d.ts has it as another name of DOMRect. Here it is a class of its own, with four numbers.
  SVGRect: {
    type: null,
    value: useLibDom(
      "SVGRect",
      "{ prototype: { x: number; y: number; width: number; height: number }; new (): DOMRect }",
    ),
  },
  // Not in lib.dom.d.ts yet. It has no members of its own.
  HTMLSelectedContentElement: {
    type: null,
    value: useLibDom("HTMLSelectedContentElement", "{ prototype: HTMLElement; new (): HTMLElement }"),
  },
};

const exportedNames = new Set(
  [...runtime.keys()].filter(
    name => handWritten[name] || bunGlobals.has(name) || constructors.has(name) || namespaces.has(name),
  ),
);
const exported: string[] = [];
prefix = "__internal.";
for (const name of runtime.keys()) {
  if (!exportedNames.has(name)) {
    console.error(`warning: ${name} is left out: it is not in lib.dom.d.ts and not written by hand`);
  } else if (bunGlobals.has(name) && !handWritten[name]) {
    exported.push(`export import ${name} = globalThis.${name};`);
  } else if (namespaces.has(name)) {
    const statics = runtime.get(name)!.static;
    const declarations = namespaces
      .get(name)!
      .statements.flatMap((statement): ts.NamedDeclaration[] =>
        ts.isVariableStatement(statement)
          ? [...statement.declarationList.declarations]
          : ts.isFunctionDeclaration(statement)
            ? [statement]
            : [],
      );
    const members = renderMembers(name, declarations, member => statics.has(member));
    const type = members.map(member => member.replace(/^(\/\*.*\*\/\n)?function /, "$1")).join("\n");
    exported.push(`export var ${name}: ${useLibDom(name, `{\n${type}\n}`)};`);
  } else {
    if (!bunGlobals.has(name) && (interfaces.has(name) || aliases.has(name))) references.push(name);
    const comment = interfaces.has(name) ? documentation(interfaces.get(name)![0]!) : "";
    exported.push(
      handWritten[name]?.type ?? `${comment}export type ${name} = (typeof ${name})["prototype"];`,
      `export var ${name}: ${handWritten[name]?.value ?? useLibDom(name, renderConstructor(name))};`,
    );
  }
}

const emitted = new Set<string>();
for (const queue = references; queue.length > 0;) {
  const name = queue.pop()!;
  if (emitted.has(name)) continue;
  emitted.add(name);
  queue.push(...renderDeclaration(name).references);
}

for (const [name, { members }] of runtime) {
  if (bunGlobals.has(name) || !interfaces.has(name)) continue;
  const declared = new Set<string | undefined>();
  const collect = (interfaceName: string) => {
    for (const member of membersOf(interfaceName)) declared.add(memberName(member));
    for (const parent of parentsOf(interfaceName)) collect(parent.expression.getText());
  };
  collect(name);
  const unknown = [...members].filter(
    member => !declared.has(member) && !runtime.has(member) && !member.startsWith("[Symbol."),
  );
  if (unknown.length > 0) report.push(`at run time, not in lib.dom.d.ts: ${name}: ${unknown.join(" ")}`);
}

const output = `// Generated by scripts/generate-dom.ts. Do not edit this file by hand.
//
// Most of it is taken from TypeScript's lib.dom.d.ts and changed: only what bun:dom has at run time
// is kept, and the comments are shortened. That part is under the license of lib.dom.d.ts:

${license}

/**
 * A native DOM: WebKit's DOM and HTML parser, without rendering, layout, frames, navigation or loading.
 *
 * @example
 * \`\`\`ts
 * import { DOMParser } from "bun:dom";
 *
 * const document = new DOMParser().parseFromString("<a href='/docs'>Docs</a>", "text/html");
 * document.querySelector("a")?.getAttribute("href"); // "/docs"
 * \`\`\`
 *
 * In a project that loads TypeScript's \`lib.dom\`, every export has lib.dom's own type.
 * In any other project the types are the ones in this file, and nothing is added to the global scope.
 */
declare module "bun:dom" {
${exported.join("\n")}

const dom: Omit<typeof import("bun:dom"), "default">;
export default dom;

/** What the exports are without \`lib.dom\`, and the types they mention. */
export namespace __internal {
${[...emitted]
  .sort()
  .map(name => renderDeclaration(name).text)
  .join("\n")}
}
}
`;
writeFileSync(join(packageRoot, "dom.d.ts"), output);

if (process.argv.includes("--report")) console.log(report.map(line => line.replace(/\s+/g, " ")).join("\n"));
console.error(`${exportedNames.size} exports, ${emitted.size} declarations in the namespace`);
