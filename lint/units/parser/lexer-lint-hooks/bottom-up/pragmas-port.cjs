// Line-for-line JavaScript transliteration of typescript-go 89d5d5b:
//   internal/scanner/scanner.go  iterateCommentRanges (trailing=false), isShebangTrivia, scanShebangTrivia
//   internal/parser/parser.go    getCommentPragmas, extractPragmas, match, skipBlanks, skipNonBlanks, skipTo,
//                                lineEndPos, extractName, extractQuotedString, processPragmasIntoFields, parseResolutionMode
// Offsets are UTF-8 byte offsets, as in the Go source. node pragmas-port.cjs pragmas-inputs.json
const fs = require("fs");
const enc = s => Buffer.from(s, "utf8");
const isLineBreak = ch => ch === 0x0a || ch === 0x0d || ch === 0x2028 || ch === 0x2029;
const wsSingle = new Set([0x20, 0x09, 0x0b, 0x0c, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x200b, 0x202f, 0x205f, 0x3000, 0xfeff]);
const isWhiteSpaceLike = ch => wsSingle.has(ch) || isLineBreak(ch);
function decode(b, pos) { // utf8.DecodeRuneInString
  const c = b[pos];
  if (c < 0x80) return [c, 1];
  let n = c >= 0xf0 ? 4 : c >= 0xe0 ? 3 : c >= 0xc0 ? 2 : 1;
  if (n === 1 || pos + n > b.length) return [0xfffd, 1];
  let cp = c & (0xff >> (n + 1));
  for (let i = 1; i < n; i++) { if ((b[pos + i] & 0xc0) !== 0x80) return [0xfffd, 1]; cp = (cp << 6) | (b[pos + i] & 0x3f); }
  return [cp, n];
}
function leadingCommentRanges(text) { // iterateCommentRanges(f, text, 0, false)
  const out = []; let pos = 0; let pending = null; let collecting = true;
  if (text.length >= 2 && text[0] === 0x23 && text[1] === 0x21) { pos = 2; while (pos < text.length) { const [ch, size] = decode(text, pos); if (isLineBreak(ch)) break; pos += size; } }
  scan: while (pos >= 0 && pos < text.length) {
    const [ch, size] = decode(text, pos);
    switch (ch) {
      case 0x0d: if (pos + 1 < text.length && text[pos + 1] === 0x0a) pos++; // fallthrough
      case 0x0a: pos++; collecting = true; if (pending) pending.hasTrailingNewLine = true; continue;
      case 0x09: case 0x0b: case 0x0c: case 0x20: pos++; continue;
      case 0x2f: {
        const next = pos + 1 < text.length ? text[pos + 1] : 0; let hasTrailingNewLine = false;
        if (next === 0x2f || next === 0x2a) {
          const kind = next === 0x2f ? "SingleLine" : "MultiLine"; const startPos = pos; pos += 2;
          if (next === 0x2f) { while (pos < text.length) { const [c, s] = decode(text, pos); if (isLineBreak(c)) { hasTrailingNewLine = true; break; } pos += s; } }
          else { const i = text.indexOf("*/", pos); pos = i >= 0 ? i + 2 : text.length; }
          if (collecting) { if (pending) out.push(pending); pending = { pos: startPos, end: pos, kind, hasTrailingNewLine }; }
          continue;
        }
        break scan;
      }
      default:
        if (ch > 127 && isWhiteSpaceLike(ch)) { if (pending && isLineBreak(ch)) pending.hasTrailingNewLine = true; pos += size; continue; }
        break scan;
    }
  }
  if (pending) out.push(pending);
  return out;
}
const match = (t, pos, s) => t.subarray(pos, pos + s.length).equals(enc(s)) && pos <= t.length;
const skipBlanks = (t, pos) => { while (pos < t.length && (t[pos] === 0x20 || t[pos] === 0x09)) pos++; return pos; };
const skipNonBlanks = (t, pos) => { while (pos < t.length && t[pos] !== 0x20 && t[pos] !== 0x09 && t[pos] !== 0x0d && t[pos] !== 0x0a) pos++; return pos; };
const skipTo = (t, pos, s) => { if (pos >= t.length) return -1; const i = t.indexOf(s, pos); return i < 0 ? -1 : i; };
const lineEndPos = (t, pos) => { while (pos < t.length) { const [ch, size] = decode(t, pos); if (isLineBreak(ch)) return pos; pos += size; } return t.length; };
const extractName = (t, pos) => { const start = pos; while (pos < t.length && ((t[pos] >= 0x41 && t[pos] <= 0x5a) || (t[pos] >= 0x61 && t[pos] <= 0x7a) || t[pos] === 0x2d)) pos++; return t.subarray(start, pos).toString("latin1").toLowerCase(); };
const extractQuotedString = (t, pos) => { if (pos === t.length) return null; const q = t[pos]; if (q !== 0x27 && q !== 0x22) return null; pos++; const start = pos; while (pos < t.length && t[pos] !== q) pos++; if (pos === t.length) return null; return t.subarray(start, pos); };
function extractPragmas(range, text) {
  if (range.kind === "SingleLine") {
    let pos = 2; const tripleSlash = match(text, pos, "/"); if (tripleSlash) pos++;
    pos = skipBlanks(text, pos);
    if (tripleSlash && match(text, pos, "<")) {
      const tagName = extractName(text, pos + 1); if (tagName !== "reference") return [];
      pos += 10; const args = {};
      for (;;) {
        pos = skipBlanks(text, pos); if (match(text, pos, "/>")) break;
        const argName = extractName(text, pos); if (argName === "") break;
        pos = skipBlanks(text, pos + argName.length); if (!match(text, pos, "=")) break;
        pos = skipBlanks(text, pos + 1); const value = extractQuotedString(text, pos); if (value === null) break;
        args[argName] = { name: argName, value: value.toString("utf8"), pos: range.pos + pos + 1, end: range.pos + pos + 1 + value.length };
        pos += value.length + 2;
      }
      return [{ range, name: "reference", args }];
    }
    if (match(text, pos, "@")) { pos++; const name = extractName(text, pos); if (!(name === "ts-check" || name === "ts-nocheck")) return []; return [{ range, name, args: {} }]; }
  }
  if (range.kind === "MultiLine") {
    if (text.length >= 2 && text.subarray(text.length - 2).equals(enc("*/"))) text = text.subarray(0, text.length - 2);
    let pos = 2; const pragmas = [];
    for (;;) {
      pos = skipTo(text, pos, "@"); if (pos < 0) break;
      const namePos = pos + 1; const nameEnd = skipNonBlanks(text, namePos);
      if (nameEnd === namePos) { pos++; continue; }
      const lineEnd = lineEndPos(text, pos); const pragmaName = text.subarray(namePos, nameEnd).toString("utf8").replace(/\u0130/g, "i").replace(/\u212a/g, "k").toLowerCase(); // Go strings.ToLower maps U+0130 to i and U+212A to k
      if (pragmaName === "jsx" || pragmaName === "jsxfrag" || pragmaName === "jsximportsource" || pragmaName === "jsxruntime") {
        const start = skipBlanks(text, nameEnd); const argEnd = skipNonBlanks(text, start);
        if (argEnd !== start) pragmas.push({ range, name: pragmaName, args: { factory: { name: "factory", value: text.subarray(start, argEnd).toString("utf8"), pos: range.pos + start, end: range.pos + argEnd } } });
      }
      pos = lineEnd;
    }
    return pragmas;
  }
  return [];
}
function readHeader(source) {
  const text = enc(source); const pragmas = [];
  for (const r of leadingCommentRanges(text)) pragmas.push(...extractPragmas(r, text.subarray(r.pos, r.end)));
  const h = { pragmas, checkJsDirective: null, referencedFiles: [], typeReferenceDirectives: [], libReferenceDirectives: [], diagnostics: [] };
  for (const p of pragmas) {
    if (p.name === "reference") {
      const a = p.args; const preserve = !!a.preserve && a.preserve.value === "true";
      if (a["no-default-lib"] && a["no-default-lib"].value === "true") { /* ignored */ }
      else if (a.types) {
        let mode = "None";
        if (a["resolution-mode"]) { const m = a["resolution-mode"]; if (m.value === "import") mode = "ESNext"; else if (m.value === "require") mode = "CommonJS"; else h.diagnostics.push({ pos: m.pos, end: m.end, code: 1453 }); }
        h.typeReferenceDirectives.push({ pos: a.types.pos, end: a.types.end, fileName: a.types.value, resolutionMode: mode, preserve });
      } else if (a.lib) h.libReferenceDirectives.push({ pos: a.lib.pos, end: a.lib.end, fileName: a.lib.value, preserve });
      else if (a.path) h.referencedFiles.push({ pos: a.path.pos, end: a.path.end, fileName: a.path.value, preserve });
      else h.diagnostics.push({ pos: p.range.pos, end: p.range.end, code: 1084 });
    } else if (p.name === "ts-check" || p.name === "ts-nocheck") {
      if (h.checkJsDirective === null || p.range.pos > h.checkJsDirective.range.pos) h.checkJsDirective = { enabled: p.name === "ts-check", range: p.range };
    }
  }
  return h;
}
module.exports = { readHeader, leadingCommentRanges };
if (require.main === module) {
  const inputs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  for (const [name, source] of inputs) {
    const h = readHeader(source);
    console.log(`--- ${name} ${JSON.stringify(source)}`);
    for (const p of h.pragmas) console.log(`pragma ${p.name} comment=${p.range.pos}..${p.range.end} ${p.range.kind} nl=${p.range.hasTrailingNewLine} args=${JSON.stringify(Object.values(p.args).map(a => [a.name, a.value, a.pos, a.end]))}`);
    if (h.checkJsDirective) console.log(`checkJs enabled=${h.checkJsDirective.enabled} range=${h.checkJsDirective.range.pos}..${h.checkJsDirective.range.end}`);
    for (const r of h.referencedFiles) console.log(`path ${JSON.stringify(r.fileName)} ${r.pos}..${r.end} preserve=${r.preserve}`);
    for (const r of h.typeReferenceDirectives) console.log(`types ${JSON.stringify(r.fileName)} ${r.pos}..${r.end} mode=${r.resolutionMode} preserve=${r.preserve}`);
    for (const r of h.libReferenceDirectives) console.log(`lib ${JSON.stringify(r.fileName)} ${r.pos}..${r.end} preserve=${r.preserve}`);
    for (const d of h.diagnostics) console.log(`diag TS${d.code} ${d.pos}..${d.end}`);
  }
}
