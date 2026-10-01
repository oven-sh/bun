// The canonical text of an AST of regexpp as the Rust test is to write it: JSON.stringify of upstream's
// cloneWithoutCircular, made here from explicit tables of the fields of each node type (no Object.keys), so that the
// same tables can be written in Rust. Checked against every "ast" baseline of upstream and every visitor history.
// usage: node dump-spec.cjs [--regexpp /workspace/ref/regexpp]
"use strict";
const fs = require("fs"), path = require("path");
const regexpp = require("/workspace/ref/eslint/node_modules/@eslint-community/regexpp");
const root = process.argv.includes("--regexpp") ? process.argv[process.argv.indexOf("--regexpp") + 1] : "/workspace/ref/regexpp";
// After the five common fields (type, parent, start, end, raw). n: a node, n?: a node or null, N: a list of nodes,
// v: a value, r: one node or a list of nodes given as paths, R: a list of nodes given as paths.
function fields(node) {
  switch (node.type) {
    case "RegExpLiteral": return [["pattern", "n"], ["flags", "n"]];
    case "Pattern": return [["alternatives", "N"]];
    case "Alternative": return [["elements", "N"]];
    case "Group": return [["modifiers", "n?"], ["alternatives", "N"]];
    case "CapturingGroup": return [["name", "v"], ["alternatives", "N"], ["references", "R"]];
    case "Assertion":
      if (node.kind === "lookahead" || node.kind === "lookbehind") return [["kind", "v"], ["negate", "v"], ["alternatives", "N"]];
      if (node.kind === "word") return [["kind", "v"], ["negate", "v"]];
      return [["kind", "v"]];
    case "Quantifier": return [["min", "v"], ["max", "v"], ["greedy", "v"], ["element", "n"]];
    case "CharacterClass": return [["unicodeSets", "v"], ["negate", "v"], ["elements", "N"]];
    case "CharacterClassRange": return [["min", "n"], ["max", "n"]];
    case "CharacterSet":
      if (node.kind === "any") return [["kind", "v"]];
      if (node.kind === "property") return [["kind", "v"], ["strings", "v"], ["key", "v"], ["value", "v"], ["negate", "v"]];
      return [["kind", "v"], ["negate", "v"]];
    case "ExpressionCharacterClass": return [["negate", "v"], ["expression", "n"]];
    case "ClassIntersection": case "ClassSubtraction": return [["left", "n"], ["right", "n"]];
    case "ClassStringDisjunction": return [["alternatives", "N"]];
    case "StringAlternative": return [["elements", "N"]];
    case "Character": return [["value", "v"]];
    case "Backreference": return [["ref", "v"], ["ambiguous", "v"], ["resolved", "r"]];
    case "Modifiers": return [["add", "n"], ["remove", "n?"]];
    case "ModifierFlags": return [["ignoreCase", "v"], ["multiline", "v"], ["dotAll", "v"]];
    case "Flags": return [["global", "v"], ["ignoreCase", "v"], ["multiline", "v"], ["unicode", "v"], ["sticky", "v"], ["dotAll", "v"], ["hasIndices", "v"], ["unicodeSets", "v"]];
    default: throw new Error("type " + node.type);
  }
}
// The path of every node: the names of the fields and the indices from the root, as segments.
function assign(node, segments, paths) {
  paths.set(node, segments);
  for (const [name, kind] of fields(node)) {
    const value = node[name];
    if (kind === "n" || (kind === "n?" && value)) assign(value, [...segments, name], paths);
    else if (kind === "N") value.forEach((child, i) => assign(child, [...segments, name, String(i)], paths));
  }
}
// posix.relative of two absolute paths given as segments.
function relative(from, to) {
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) common++;
  return [...from.slice(common).map(() => ".."), ...to.slice(common)].join("/");
}
const str = s => JSON.stringify(s);
const num = v => (v === Infinity ? '"$$Infinity"' : String(v));
const val = v => (typeof v === "number" ? num(v) : v === null ? "null" : typeof v === "boolean" ? String(v) : str(v));
function write(node, paths) {
  const here = paths.get(node);
  const link = to => str("\u267b\ufe0f" + relative(here, paths.get(to)));
  let out = `{"type":${str(node.type)},"parent":${node.parent ? link(node.parent) : "null"},"start":${node.start},"end":${node.end},"raw":${str(node.raw)}`;
  for (const [name, kind] of fields(node)) {
    const value = node[name];
    out += `,${str(name)}:`;
    if (kind === "n") out += write(value, paths);
    else if (kind === "n?") out += value ? write(value, paths) : "null";
    else if (kind === "N") out += "[" + value.map(child => write(child, paths)).join(",") + "]";
    else if (kind === "R") out += "[" + value.map(link).join(",") + "]";
    else if (kind === "r") out += Array.isArray(value) ? "[" + value.map(link).join(",") + "]" : link(value);
    else out += val(value);
  }
  return out + "}";
}
function dump(ast) { const paths = new Map(); assign(ast, [], paths); return write(ast, paths); }
module.exports = { dump };
if (require.main === module) {
  function* walk(dir, rel = "") { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.isDirectory()) yield* walk(path.join(dir, e.name), rel + e.name + "/"); else if (e.name.endsWith(".json")) yield rel + e.name; } }
  const literalRoot = path.join(root, "test/fixtures/parser/literal");
  let asts = 0, errors = 0, wrong = 0;
  for (const file of walk(literalRoot)) {
    const fixture = JSON.parse(fs.readFileSync(path.join(literalRoot, file), "utf8"));
    for (const [source, result] of Object.entries(fixture.patterns)) {
      let got;
      try { got = { ast: dump(regexpp.parseRegExpLiteral(source, fixture.options)) }; } catch (e) { got = { error: { message: e.message, index: e.index } }; }
      if (result.ast) { asts++; if (got.ast !== JSON.stringify(result.ast)) { if (wrong++ < 3) console.log("AST differs", file, source, "\n", got.ast, "\n", JSON.stringify(result.ast)); } }
      else { errors++; if (!got.error || got.error.message !== result.error.message || got.error.index !== result.error.index) { if (wrong++ < 3) console.log("error differs", file, source, got, result.error); } }
    }
  }
  const visitor = JSON.parse(fs.readFileSync(path.join(root, "test/fixtures/visitor/full.json"), "utf8"));
  let histories = 0;
  for (const [source, expected] of Object.entries(visitor.patterns)) {
    const history = [];
    const handlers = new Proxy({}, { get: (_, name) => typeof name === "string" && /^on\w+(Enter|Leave)$/.test(name) ? node => history.push(`${name.endsWith("Enter") ? "enter" : "leave"}:${node.type}:${node.raw}`) : undefined });
    regexpp.visitRegExpAST(regexpp.parseRegExpLiteral(source, visitor.options), handlers);
    histories++;
    if (history.join("\n") !== expected.join("\n")) { if (wrong++ < 3) console.log("history differs", source); }
  }
  console.log({ asts, errors, histories, wrong });
}
