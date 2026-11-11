// A codemod that ran once. It moves the members that globals.d.ts writes inline for the web
// globals of lib.dom to web-globals.d.ts, behind the gate `Bun.__internal.LibOrFallback`, so that a
// project that loads lib.dom.d.ts gets the declaration of lib.dom and nothing beside it.
//
// Usage:
//   bun packages/bun-types/scripts/move-web-globals.ts [--base <rev>] [--out <dir>]
//       [--extra <Name[:member+member]>,..]
//   bun fmt packages/bun-types
//
// It reads the package at <rev> (default HEAD) and writes globals.d.ts, web-globals.d.ts,
// deprecated.d.ts and index.d.ts to <dir> (default the package). Give it the commit before its
// output as <rev>, and it writes the same files again.
//
// web-globals.d.ts is a module, like the files in web-globals/ of @types/node. An interface in it
// has the web name and is local to the file. The file gives `Bun.__internal` one alias for each,
// which is `{}` when lib.dom.d.ts is loaded, and globals.d.ts declares the global with that alias.
//
// --extra moves one more interface, and keeps the members after the colon inline. It is for a
// trial: `--extra Console,Navigator --out <a copy of the package>` shows which members cannot
// move (TS2320 in a check of the copy).
import { $ } from "bun";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const PACKAGE = "packages/bun-types";

const argv = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1]!;
};
const base = option("--base", "HEAD");
const out = resolve(option("--out", join(REPO_ROOT, PACKAGE)));

interface Move {
  /**
   * Members that stay inline in the global interface: the ones that only Bun has, and the ones
   * that `expectedLibOverlapWithLibDom` in test/integration/bun-types/bun-types.test.ts gives a
   * reason for.
   */
  keep?: string[];
  /** A member of the interface in deprecated.d.ts that moves too. */
  deprecated?: string;
  /** An export of "bun" that has the same members already. It is the fallback, and the members here go away. */
  fallbackIs?: string;
  /** Comment text that is wrong once the member is behind the gate. */
  rewrite?: [from: string, to: string][];
}

const MOVES: Record<string, Move> = {
  // `File` is not here. Bun's compiler reads `File extends Blob` on the global line, and with the
  // base there a gate would be a second base (packages/bun-types/authoring.md).
  Crypto: { keep: ["getRandomValues", "randomUUID", "timingSafeEqual"] },
  ErrorEvent: {},
  CloseEvent: {},
  CustomEvent: {},
  AddEventListenerOptions: { fallbackIs: "Bun.AddEventListenerOptions" },
  QueuingStrategy: {},
  QueuingStrategyInit: {},
  ByteLengthQueuingStrategy: {
    rewrite: [
      [
        "// changed from QueuingStrategySize<BufferSource>\n  // to avoid conflict with lib.dom.d.ts\n",
        "// lib.dom.d.ts has ArrayBufferView here too, not BufferSource\n",
      ],
    ],
  },
  ReadableStreamDefaultController: { keep: ["enqueue"] },
  ReadableStreamDefaultReader: { keep: ["read", "readMany"] },
  ReadableStreamGenericReader: {},
  ReadableWritablePair: {},
  WritableStreamDefaultController: {},
  WritableStreamDefaultWriter: { keep: ["write"] },
  TransformStream: {},
  TransformStreamDefaultController: { keep: ["enqueue"] },
  StreamPipeOptions: {},
  CountQueuingStrategy: {},
  Transformer: {},
  DOMException: { deprecated: "code" },
  EventSourceInit: {},
  BlobPropertyBag: { rewrite: [['/** Set a default "type". Not yet implemented. */', '/** Set a default "type". */']] },
  Blob: { keep: ["slice", "bytes", "stream", "json", "image", "formData"] },
  AbortController: {},
  AbortSignal: {},
  MessageChannel: {},
};
for (const extra of option("--extra", "").split(",").filter(Boolean)) {
  const [name, keep] = extra.split(":");
  MOVES[name!] = keep ? { keep: keep.split("+") } : {};
}

const read = async (file: string) => await $`git -C ${REPO_ROOT} show ${base}:${PACKAGE}/${file}`.text();
const parse = (file: string, text: string) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

type Edit = { start: number; end: number; replacement: string };
function apply(text: string, edits: Edit[]): string {
  let result = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }
  return result;
}

type Block = ts.ModuleDeclaration & { body: ts.ModuleBlock };
const isBunModule = (statement: ts.Statement): statement is Block =>
  ts.isModuleDeclaration(statement) &&
  ts.isStringLiteral(statement.name) &&
  statement.name.text === "bun" &&
  statement.body !== undefined &&
  ts.isModuleBlock(statement.body);
const isInternalNamespace = (statement: ts.Statement): statement is Block =>
  ts.isModuleDeclaration(statement) &&
  ts.isIdentifier(statement.name) &&
  statement.name.text === "__internal" &&
  statement.body !== undefined &&
  ts.isModuleBlock(statement.body);

function declaredNames(statement: ts.Statement): string[] {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap(d => (ts.isIdentifier(d.name) ? [d.name.text] : []));
  }
  if (
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isFunctionDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isImportEqualsDeclaration(statement) ||
    ts.isModuleDeclaration(statement)
  ) {
    return statement.name && ts.isIdentifier(statement.name) ? [statement.name.text] : [];
  }
  return [];
}

// Inside `declare module "bun" { namespace __internal { .. } }`, a name means the declaration of
// "bun" or of `Bun.__internal` when there is one of that name. Text that leaves such a block must
// not use one of them without a qualifier.
const declaredInBun = new Set<string>();
const packageFiles = (await $`git -C ${REPO_ROOT} ls-tree --name-only ${base} ${PACKAGE}/`.text())
  .split("\n")
  .filter(path => path.endsWith(".d.ts"))
  .map(path => path.slice(PACKAGE.length + 1));
for (const file of packageFiles) {
  for (const statement of parse(file, await read(file)).statements) {
    if (!isBunModule(statement)) continue;
    for (const inner of statement.body.statements) {
      for (const name of declaredNames(inner)) declaredInBun.add(name);
      if (isInternalNamespace(inner)) {
        for (const innermost of inner.body.statements) {
          for (const name of declaredNames(innermost)) declaredInBun.add(name);
        }
      }
    }
  }
}

/** The first identifier of `A.B.C`. */
function leftmost(name: ts.EntityName | ts.Expression): ts.Identifier | undefined {
  if (ts.isIdentifier(name)) return name;
  if (ts.isQualifiedName(name)) return leftmost(name.left);
  if (ts.isPropertyAccessExpression(name)) return leftmost(name.expression);
  return undefined;
}

/** The first identifier of every type that `node` names, when it is not a type parameter in scope there. */
function typeNames(node: ts.Node, outer: ReadonlySet<string>): ts.Identifier[] {
  const found: ts.Identifier[] = [];
  const visit = (current: ts.Node, scope: ReadonlySet<string>) => {
    let inner = scope;
    const parameters = (current as { typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> }).typeParameters;
    if (parameters?.length) inner = new Set([...scope, ...parameters.map(parameter => parameter.name.text)]);
    if (ts.isMappedTypeNode(current)) inner = new Set([...inner, current.typeParameter.name.text]);

    let named: ts.EntityName | ts.Expression | undefined;
    if (ts.isTypeReferenceNode(current)) named = current.typeName;
    else if (ts.isExpressionWithTypeArguments(current)) named = current.expression;
    else if (ts.isTypeQueryNode(current)) named = current.exprName;
    const first = named && leftmost(named);
    if (first && !inner.has(first.text)) found.push(first);

    ts.forEachChild(current, child => visit(child, inner));
  };
  visit(node, outer);
  return found;
}

/**
 * The text of `node` from `from`, with `globalThis.` in front of each name of `names` that it uses.
 * It starts with an empty line when the source has one in front of it.
 */
function textWithGlobals(
  source: ts.SourceFile,
  node: ts.Node,
  from: number,
  names: ReadonlySet<string>,
  scope: ReadonlySet<string>,
): string {
  const inserts = typeNames(node, scope)
    .filter(name => names.has(name.text) && name.getStart(source) >= from)
    .map(name => name.getStart(source))
    .sort((a, b) => a - b);
  let text = "";
  let at = from;
  for (const position of inserts) {
    text += source.text.slice(at, position) + "globalThis.";
    at = position;
  }
  text += source.text.slice(at, node.end);
  const emptyLines = /^(?:[ \t]*\n)*/.exec(text)![0];
  return (emptyLines.split("\n").length > 2 ? "\n" : "") + text.slice(emptyLines.length);
}

/** Members one below the other, with the empty lines that the source has between them. */
const lines = (members: readonly string[]) =>
  members.map((member, index) => (index === 0 ? member.replace(/^\n/, "") : member)).join("\n");

const memberName = (member: ts.TypeElement, source: ts.SourceFile) => (member.name ? member.name.getText(source) : "");
const dedent = (text: string, by: number) =>
  text
    .split("\n")
    .map(line => (line.startsWith(" ".repeat(by)) ? line.slice(by) : line.trimStart()))
    .join("\n");

const globalsText = await read("globals.d.ts");
const globals = parse("globals.d.ts", globalsText);
const deprecatedText = await read("deprecated.d.ts");
const deprecated = parse("deprecated.d.ts", deprecatedText);

// The `__internal` block of globals.d.ts that declares the gate.
const gateBlocks = globals.statements
  .filter(isBunModule)
  .flatMap(module => module.body.statements.filter(isInternalNamespace))
  .filter(namespace =>
    namespace.body.statements.some(s => ts.isTypeAliasDeclaration(s) && s.name.text === "LibOrFallback"),
  );
if (gateBlocks.length !== 1) {
  throw new Error(`expected one __internal block with LibOrFallback in globals.d.ts, found ${gateBlocks.length}`);
}
// The fallbacks that the block has already. They move to the file too, so that it has all of them.
const blockFallbacks = gateBlocks[0]!.body.statements.filter(
  (statement): statement is ts.InterfaceDeclaration =>
    ts.isInterfaceDeclaration(statement) && statement.name.text.startsWith("Fallback"),
);

interface Local {
  /** The name of the interface in web-globals.d.ts. */
  name: string;
  /** `<T = any>`, or "". */
  parameters: string;
  /** `<T>`, or "". */
  arguments: string;
  heritage: string[];
  /** The leading comment of the interface, when it was in the `__internal` block already. */
  comment: string;
  /** The members, each from its leading comment, as they are at an indent of two spaces. */
  members: string[];
}
interface Alias {
  /** `LibOrFallbackBlob<T = any>`. */
  declaration: string;
  /** `LibOrFallback<LocalBlob<T>>`. */
  type: string;
}
const locals: Local[] = [];
const aliases: Alias[] = [];
const edits: Edit[] = [];
const deprecatedEdits: Edit[] = [];

// An interface of web-globals.d.ts hides the global of its name in that file.
const localNames = new Set<string>();
for (const [name, move] of Object.entries(MOVES)) if (!move.fallbackIs) localNames.add(name);
for (const declaration of blockFallbacks) localNames.add(declaration.name.text.slice("Fallback".length));

for (const declaration of blockFallbacks) {
  const name = declaration.name.text.slice("Fallback".length);
  const parameters = declaration.typeParameters ?? [];
  const scope = new Set(parameters.map(parameter => parameter.name.text));
  for (const used of typeNames(declaration, new Set())) {
    if (declaredInBun.has(used.text)) {
      throw new Error(`${declaration.name.text} names ${used.text}, which "bun" declares: qualify it by hand`);
    }
  }
  const comment = globalsText.slice(declaration.getFullStart(), declaration.getStart(globals)).trim();
  const pass = parameters.length ? `<${parameters.map(parameter => parameter.name.text).join(", ")}>` : "";
  const declare = parameters.length ? `<${parameters.map(parameter => parameter.getText(globals)).join(", ")}>` : "";
  locals.push({
    name,
    parameters: declare,
    arguments: pass,
    heritage: (declaration.heritageClauses ?? []).flatMap(clause =>
      clause.types.map(type => textWithGlobals(globals, type, type.getStart(globals), localNames, scope)),
    ),
    comment: comment && dedent(comment, 4),
    members: declaration.members.map(member =>
      dedent(textWithGlobals(globals, member, member.getFullStart(), localNames, scope), 4),
    ),
  });
  edits.push({ start: declaration.getFullStart(), end: declaration.end, replacement: "" });

  // `Bun.__internal.LibOrFallback<Bun.__internal.FallbackFormData>` on a global line becomes
  // `Bun.__internal.LibOrFallbackFormData`, and `LibIterableOrFallback<..FallbackFormDataIterable>`
  // becomes `LibIterableOrFallbackFormData`.
  const gateOfFallback = new RegExp(`Bun\\.__internal\\.(\\w+)<Bun\\.__internal\\.Fallback${name}>`, "g");
  const uses = [...globalsText.matchAll(gateOfFallback)];
  if (uses.length === 0) throw new Error(`globals.d.ts has no gate of ${declaration.name.text}`);
  for (const use of uses) {
    const gate = use[1]!;
    const alias = gate + (gate.includes("Iterable") ? name.replace(/Iterable$/, "") : name);
    if (!aliases.some(each => each.declaration === alias + declare)) {
      aliases.push({ declaration: alias + declare, type: `${gate}<Local${name}${pass}>` });
    }
    edits.push({ start: use.index, end: use.index + use[0].length, replacement: `Bun.__internal.${alias}` });
  }
}

const moved = new Set<string>();
for (const statement of globals.statements) {
  if (!ts.isInterfaceDeclaration(statement)) continue;
  const name = statement.name.text;
  const move = MOVES[name];
  if (!move) continue;
  if (moved.has(name)) throw new Error(`globals.d.ts declares interface ${name} twice`);
  moved.add(name);

  const parameters = statement.typeParameters ?? [];
  const scope = new Set(parameters.map(parameter => parameter.name.text));
  const heritage = (statement.heritageClauses ?? []).flatMap(clause => [...clause.types]);
  for (const type of heritage) {
    if (type.getText(globals).startsWith("Bun.__internal.")) {
      throw new Error(`interface ${name} is behind ${type.getText(globals)} already`);
    }
  }

  const keep = new Set(move.keep);
  const unknown = [...keep].filter(member => !statement.members.some(each => memberName(each, globals) === member));
  if (unknown.length) throw new Error(`interface ${name} has no member ${unknown.join(", ")}`);
  const kept = statement.members.filter(member => keep.has(memberName(member, globals)));
  const gated = statement.members.filter(member => !keep.has(memberName(member, globals)));

  // The interface of the file declares only the type parameters that its members name.
  const named = new Set(gated.flatMap(member => typeNames(member, new Set()).map(used => used.text)));
  const used = move.fallbackIs ? [] : parameters.filter(parameter => named.has(parameter.name.text));
  const declare = used.length ? `<${used.map(parameter => parameter.getText(globals)).join(", ")}>` : "";
  const pass = used.length ? `<${used.map(parameter => parameter.name.text).join(", ")}>` : "";

  if (move.fallbackIs) {
    if (kept.length) throw new Error(`interface ${name}: fallbackIs takes every member`);
    aliases.push({ declaration: `LibOrFallback${name}`, type: `LibOrFallback<${move.fallbackIs}>` });
  } else {
    let members = gated.map(member => textWithGlobals(globals, member, member.getFullStart(), localNames, scope));
    // A comment between the last member and the closing brace stays with the members.
    const last = statement.members.at(-1);
    if (last) {
      const tail = globalsText.slice(last.end, statement.end - 1).trimEnd();
      if (tail.trim()) members.push(tail.replace(/^(?:[ \t]*\n)+/, ""));
    }
    if (move.deprecated) {
      const other = deprecated.statements.find(
        (each): each is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(each) && each.name.text === name,
      );
      const member = other?.members.find(each => memberName(each, deprecated) === move.deprecated);
      if (!other || !member) throw new Error(`deprecated.d.ts has no ${name}.${move.deprecated}`);
      if (other.members.length !== 1) throw new Error(`interface ${name} of deprecated.d.ts has other members too`);
      members.push(textWithGlobals(deprecated, member, member.getFullStart(), localNames, scope));
      // The empty line in front of the interface goes with it.
      deprecatedEdits.push({ start: other.getFullStart(), end: other.end, replacement: "" });
    }
    for (const [from, to] of move.rewrite ?? []) {
      const before = members.join("\n");
      members = members.map(member => member.replace(from, to));
      if (members.join("\n") === before) throw new Error(`interface ${name}: nothing to rewrite for ${from}`);
    }
    locals.push({
      name,
      parameters: declare,
      arguments: pass,
      // The bases go with the members, as in @types/node: a member overrides the member of a base
      // here as it did in globals.d.ts. On the global line, beside the gate, it cannot (TS2320).
      heritage: heritage.map(type => textWithGlobals(globals, type, type.getStart(globals), localNames, scope)),
      comment: "",
      members,
    });
    aliases.push({ declaration: `LibOrFallback${name}${declare}`, type: `LibOrFallback<Local${name}${pass}>` });
  }

  const all = parameters.length ? `<${parameters.map(parameter => parameter.getText(globals)).join(", ")}>` : "";
  const body = kept.length
    ? `{\n${lines(kept.map(member => textWithGlobals(globals, member, member.getFullStart(), new Set(), scope)))}\n}`
    : "{}";
  edits.push({
    start: statement.getStart(globals),
    end: statement.end,
    replacement: `interface ${name}${all} extends Bun.__internal.LibOrFallback${name}${pass} ${body}`,
  });
}
const missing = Object.keys(MOVES).filter(name => !moved.has(name));
if (missing.length) throw new Error(`globals.d.ts has no interface ${missing.join(", ")}`);

const file =
  `/*
 * The web globals that bun-types declares itself, as they are when lib.dom.d.ts is not loaded.
 *
 * This file is a module, like the files in web-globals/ of @types/node. So an interface here is
 * local to the file. It is not the global of its name, and it does not merge with lib.dom.d.ts.
 * At its end the file gives \`Bun.__internal\` one alias for each interface, which is \`{}\` when
 * lib.dom.d.ts is loaded. globals.d.ts declares the globals, each with its alias as its base:
 *
 *     interface AbortController extends Bun.__internal.LibOrFallbackAbortController {}
 *
 * So a project that loads lib.dom.d.ts gets no member from this file. This file declares no
 * global: the API reference on bun.com takes the globals from globals.d.ts (see fetch.d.ts).
 *
 * In this file a name such as \`Blob\` means the interface of this file. \`globalThis.Blob\` is the
 * global, which also has what lib.dom.d.ts, @types/node and a project add to it. The type of a
 * member, and a base, names the global. A case in test/integration/bun-types/bun-types.test.ts
 * fails for a name of this file that is written without \`globalThis.\`.
 *
 * What does not go here:
 *   - A member that only Bun has, because a project that loads lib.dom.d.ts does not get these
 *     interfaces. It stays a member of the global interface in globals.d.ts, as \`Blob.json()\`.
 *   - An interface that "bun" exports with the same members. The export is the fallback:
 *     \`LibOrFallback<Bun.AddEventListenerOptions>\`.
 *   - A \`declare var\`. It stays in globals.d.ts.
 */
export {};

` +
  locals
    .map(
      local =>
        (local.comment ? `${local.comment}\n` : "") +
        `interface ${local.name}${local.parameters}` +
        (local.heritage.length ? ` extends ${local.heritage.join(", ")}` : "") +
        ` {\n${lines(local.members)}\n}`,
    )
    .join("\n\n") +
  `

// Inside \`declare module "bun"\`, a name means the export of "bun" when "bun" has one of that name,
// as it has for \`WebSocket\` and \`MessageEvent\`. These names stay the interfaces of this file.
` +
  locals.map(local => `type Local${local.name}${local.parameters} = ${local.name}${local.arguments};`).join("\n") +
  `

declare module "bun" {
  namespace __internal {
` +
  aliases.map(alias => `    type ${alias.declaration} = ${alias.type};`).join("\n") +
  `
  }
}
`;

const index = await read("index.d.ts");
const reference = '/// <reference path="./globals.d.ts" />\n';
if (!index.includes(reference)) throw new Error("index.d.ts does not reference globals.d.ts");

writeFileSync(join(out, "web-globals.d.ts"), file);
writeFileSync(
  join(out, "index.d.ts"),
  index.replace(reference, `${reference}/// <reference path="./web-globals.d.ts" />\n`),
);
writeFileSync(join(out, "globals.d.ts"), apply(globalsText, edits));
writeFileSync(join(out, "deprecated.d.ts"), apply(deprecatedText, deprecatedEdits));

console.log(`${moved.size} interfaces of globals.d.ts, ${locals.length} interfaces in web-globals.d.ts`);
