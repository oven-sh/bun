// Native-parser helpers for the ported node:repl. These replace the
// vendored acorn: syntax checking and the top-level-await transform run
// on Bun's own bun_js_parser instead.
const { RegExpPrototypeExec, StringPrototypeIncludes } = require("internal/repl/node-primordials");

const checkSyntaxNative = $newRustFunction("node_repl_binding.rs", "checkSyntax", 1);

let replTranspiler;
function getReplTranspiler() {
  return (replTranspiler ??= new Bun.Transpiler({
    loader: "js",
    // Applies js_parser/repl_transforms.rs: hoist declarations to `var`,
    // wrap the body in an async IIFE, and return `{ __proto__:null, value }`.
    replMode: true,
    minifyWhitespace: false,
    deadCodeElimination: false,
  }));
}

function classifyRecoverable(code) {
  // Mirror upstream: expressions that start with `{` are ambiguous with a
  // block statement, so try `(` + code first.
  if (RegExpPrototypeExec(/^\s*\{/, code) !== null && classifyRecoverable("(" + code)) return true;

  const err = checkSyntaxNative(code);
  if (err === null) {
    // Parses cleanly here but the engine rejected it (e.g. JSC-specific
    // early error) — additional input won't fix that.
    return false;
  }
  const { message, atEOF, tokenStart } = err;

  if (atEOF) return true;
  if (StringPrototypeIncludes(message, "end of file")) return true;
  if (message === 'Expected "*/" to terminate multi-line comment') return true;
  if (message === "Unterminated string literal") {
    // Templates and backslash-continued strings may span lines; a plain
    // string that hit a newline (or EOF) without a `\` cannot. An unterminated
    // template reports the start of the failing token: the backtick, or \u2014 once
    // a `${\u2026}` substitution has been consumed \u2014 the `}` that opens the tail.
    if (tokenStart === "`" || tokenStart === "}") return true;
    return RegExpPrototypeExec(/\\(?:\r\n?|\n|\u2028|\u2029)$/, code) !== null;
  }
  return false;
}

function isValidSyntax(code) {
  return checkSyntaxNative(code) === null;
}

// bun_js_parser's repl_mode already implements the same rewrite Node's
// internal/repl/await.js does with acorn-walk (var-hoist declarations,
// async-IIFE wrap, `{__proto__:null, value: <last expr>}` return).
// The transform's own IIFE always follows zero-or-more hoist statements at the
// START of the output; each is a `var` with a comma-separated identifier list
// and never an initializer (`var a, b;` for `const {a,b} = await f()`).
// Anchoring on the no-initializer shape keeps a user's own async arrow after
// their own `var x = 1;` from false-positiving.
const replModeAsyncWrapRE =
  /^(?:var [\p{ID_Start}$_][\p{ID_Continue}$_]*(?:,\s*[\p{ID_Start}$_][\p{ID_Continue}$_]*)*;\s*)*\(async\s*\(\)\s*=>/u;

function processTopLevelAwait(src) {
  if (RegExpPrototypeExec(/\bawait\b/, src) === null) return null;
  try {
    const out = getReplTranspiler().transformSync(src);
    return RegExpPrototypeExec(replModeAsyncWrapRE, out) !== null ? out : null;
  } catch {
    // Parse error — let defaultEval's own vm.Script path report it so
    // the REPL renders it via the usual error handler.
    return null;
  }
}

const idStart = /^[$_\p{ID_Start}]$/u;
const idContinue = /^[$_\u200C\u200D\p{ID_Continue}]$/u;

function isIdentifierStart(cp) {
  // ASCII fast path avoids the regex-per-codepoint cost for the common case.
  if (cp < 128) return cp === 36 || cp === 95 || (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122);
  return RegExpPrototypeExec(idStart, String.fromCodePoint(cp)) !== null;
}
function isIdentifierChar(cp) {
  if (cp < 128)
    return cp === 36 || cp === 95 || (cp >= 48 && cp <= 57) || (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122);
  return RegExpPrototypeExec(idContinue, String.fromCodePoint(cp)) !== null;
}

// Drop-in for internal/repl/utils.js's acorn-based isRecoverableError. `e`
// (the engine's own SyntaxError) is unused — Bun's parser is the oracle.
function isRecoverableError(e, code) {
  return classifyRecoverable(code);
}

export default {
  isRecoverableError,
  isValidSyntax,
  processTopLevelAwait,
  isIdentifierStart,
  isIdentifierChar,
};
