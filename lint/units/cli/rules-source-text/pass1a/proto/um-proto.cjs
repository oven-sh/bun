// Prototype of the text-only paths planned for no-unexpected-multiline, checked node by node against ESLint's own token logic.
// usage: node um-proto.cjs <dir>... [--mutate N]    every .js file under the directories; with --mutate, N trivia insertions per file too
"use strict";
const fs = require("fs"); const path = require("path");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const astUtils = require("/workspace/ref/eslint/lib/rules/utils/ast-utils");
const linter = new Linter({ configType: "flat" });
const args = process.argv.slice(2);
const mi = args.indexOf("--mutate"); const MUT = mi >= 0 ? Number(args.splice(mi, 2)[1]) : 0;

const LT = c => c === 10 || c === 13 || c === 0x2028 || c === 0x2029;
// whether the line that ends before `end` holds what can start a comment to the end of the line
function lineHasComment(text, end) {
  let i = end;
  while (i > 0 && !LT(text.charCodeAt(i - 1))) i--;
  const line = text.slice(i, end);
  return line.includes("//") || line.includes("-->") || (i === 0 && line.startsWith("#!"));
}
// back from `at` over blanks: true: a line break stands there; false: a token ends there; null: not known without the tokens
function breakBefore(text, at) {
  let i = at;
  for (;;) {
    if (i === 0) return false;
    const c = text.charCodeAt(i - 1);
    if (c === 32 || c === 9) { i--; continue; }
    if (c === 10 || c === 13) return true;
    if (c === 47 || c === 11 || c === 12 || c >= 0x80) return null;
    return false;
  }
}
// the call: back from the first argument. { report: offset } | { report: null } | "slow"
function callFast(text, first) {
  let i = first, paren = -1, broke = false;
  for (;;) {
    if (i === 0) return "slow";
    const c = text.charCodeAt(i - 1);
    if (c === 32 || c === 9) { i--; continue; }
    if (c === 40) { i--; paren = i; broke = false; continue; }
    if (c === 10 || c === 13) { i--; broke = true; if (lineHasComment(text, i)) return "slow"; continue; }
    if (c === 47 || c === 62 || c === 11 || c === 12 || c >= 0x80) return "slow";
    break;
  }
  if (paren < 0) return "slow";
  return { report: broke ? paren : null };
}
// the member: back from the index to its `[`, then what stands before the `[`
function indexFast(text, first) {
  let i = first;
  for (;;) {
    if (i === 0) return "slow";
    const c = text.charCodeAt(i - 1);
    if (c === 32 || c === 9 || c === 40) { i--; continue; }
    if (c === 10 || c === 13) { i--; if (lineHasComment(text, i)) return "slow"; continue; }
    if (c === 91) { i--; break; }
    return "slow";
  }
  const b = breakBefore(text, i);
  return b === null ? "slow" : { report: b ? i : null };
}
function templateFast(text, quasi) {
  const b = breakBefore(text, quasi);
  return b === null ? "slow" : { report: b ? quasi : null };
}
// the first slash of `a / b / flags`: back from `b`
function divisionFast(text, bStart) {
  let i = bStart;
  for (;;) {
    if (i === 0) return "slow";
    const c = text.charCodeAt(i - 1);
    if (c === 32 || c === 9 || c === 40) { i--; continue; }
    if (c === 10 || c === 13) { i--; if (lineHasComment(text, i)) return "slow"; continue; }
    if (c === 47) { if (text.charCodeAt(i - 2) === 42) return "slow"; i--; break; }
    return "slow";
  }
  const b = breakBefore(text, i);
  return b === null ? "slow" : { report: b ? i : null };
}
const stats = { call: 0, callSlow: 0, index: 0, indexSlow: 0, template: 0, templateSlow: 0, division: 0, divisionSlow: 0, truthReports: 0, wrong: 0 };
const wrong = [];
const rule = {
  create(context) {
    const sc = context.sourceCode; const text = sc.getText();
    // the first token of a node as Bun's `loc` has it or before it: parentheses of a first operand do not matter to the scans
    const start = n => n.range[0];
    function truthAfter(node) {
      const open = sc.getTokenAfter(node, astUtils.isNotClosingParenToken);
      const prev = sc.getTokenBefore(open);
      return open.loc.start.line !== prev.loc.end.line ? open.range[0] : null;
    }
    function cmp(kind, fast, truth, node) {
      stats[kind]++;
      if (truth !== null) stats.truthReports++;
      if (fast === "slow") { stats[kind + "Slow"]++; return; }
      if (fast.report !== truth) { stats.wrong++; if (wrong.length < 20) wrong.push(`${kind} fast=${fast.report} truth=${truth} ${JSON.stringify(text.slice(Math.max(0, node.range[0] - 10), node.range[0] + 70))}`); }
    }
    return {
      MemberExpression(node) { if (!node.computed || node.optional) return; cmp("index", indexFast(text, start(node.property)), truthAfter(node.object), node); },
      CallExpression(node) { if (node.arguments.length === 0 || node.optional) return; cmp("call", callFast(text, start(node.arguments[0])), truthAfter(node.callee), node); },
      TaggedTemplateExpression(node) {
        const before = sc.getTokenBefore(node.quasi);
        cmp("template", templateFast(text, node.quasi.range[0]), before.loc.end.line !== node.quasi.loc.start.line ? node.quasi.range[0] : null, node);
      },
      "BinaryExpression[operator='/'] > BinaryExpression[operator='/'].left"(node) {
        const secondSlash = sc.getTokenAfter(node, t => t.value === "/");
        const after = sc.getTokenAfter(secondSlash);
        const applies = after.type === "Identifier" && /^[dgimsuvy]+$/u.test(after.value) && secondSlash.range[1] === after.range[0];
        // planned: the byte before the right operand of the outer division is `/` and no comment ends there, and the name is made of flags
        const c = node.parent.right.range[0];
        const planned = text.charCodeAt(c - 1) === 47 && text.charCodeAt(c - 2) !== 42 && /^[dgimsuvy]+(?![\w$\\\u0080-\uffff])/.test(text.slice(c));
        if (applies !== planned && !/\\u/.test(text.slice(c, c + 12))) { stats.wrong++; wrong.push(`division applies=${applies} planned=${planned} ${JSON.stringify(text.slice(node.range[0], node.range[0] + 60))}`); }
        if (!applies) return;
        cmp("division", divisionFast(text, start(node.right)), truthAfter(node.left), node);
      },
    };
  },
};
const config = st => [{ languageOptions: { ecmaVersion: "latest", sourceType: st, parserOptions: { ecmaFeatures: { jsx: true } } }, plugins: { x: { rules: { check: rule } } }, rules: { "x/check": "error" } }];
function run(text) { for (const st of ["module", "script"]) { const m = linter.verify(text, config(st)); if (!m.some(x => x.fatal)) return true; } return false; }
function* files(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) { if (e.name !== ".git") yield* files(p); } else if (/\.(js|cjs|mjs)$/.test(e.name)) yield p; } }
const rnd = require("./rng.cjs")(99);
const trivia = ["\n", " \n  ", " // c (\n", " // [ c\n", "/* c */", " /* (\n */ ", "\r\n", "\n\n\t", " /* [ */\n", "\n// (((\n", "\u2028", "\u00a0\n"];
let nfiles = 0, parsed = 0, mutants = 0, mutantsParsed = 0;
for (const dir of args) for (const f of files(dir)) {
  let text; try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
  if (text.length > 400000) continue;
  nfiles++; if (run(text)) parsed++;
  for (let k = 0; k < MUT; k++) {
    // put trivia before or after a bracket, a slash or a backtick
    const spots = []; const re = /[(\[`\/]/g; let m; while ((m = re.exec(text))) spots.push(m.index);
    if (!spots.length) break;
    let t = text;
    for (let j = 0; j < 3; j++) { const at = spots[rnd(spots.length)] + rnd(2); t = t.slice(0, at) + trivia[rnd(trivia.length)] + t.slice(at); }
    mutants++; if (run(t)) mutantsParsed++;
  }
}
console.log({ files: nfiles, parsed, mutants, mutantsParsed, ...stats });
for (const w of wrong) console.log(w);
