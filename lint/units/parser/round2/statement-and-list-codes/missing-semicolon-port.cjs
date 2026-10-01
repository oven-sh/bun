// A transliteration of parseErrorForMissingSemicolonAfter (parser.go:2057) for a statement that is one name followed, on its
// line, by a token that no semicolon can stand before. Checked against the typescript-go oracle by check-port.cjs.
// KEYWORDS is textToKeyword of scanner.go in the order of its source: getSpaceSuggestion takes the first keyword that fits.
// (typescript-go ranges over a Go map, whose order is random: where two keywords fit, "assert" and "asserts", "const" and
// "constructor", "type" and "typeof", it can answer either; tsc takes the first in this order.)
const KEYWORDS = ["abstract", "accessor", "any", "as", "asserts", "assert", "bigint", "boolean", "break", "case", "catch", "class", "continue", "const", "constructor", "debugger", "declare", "default", "defer", "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for", "from", "function", "get", "if", "immediate", "implements", "import", "in", "infer", "instanceof", "interface", "intrinsic", "is", "keyof", "let", "module", "namespace", "never", "new", "null", "number", "object", "package", "private", "protected", "public", "override", "out", "readonly", "require", "global", "return", "satisfies", "set", "static", "string", "super", "switch", "symbol", "this", "throw", "true", "try", "type", "typeof", "undefined", "unique", "unknown", "using", "var", "void", "while", "with", "yield", "async", "await", "of"];
const VIABLE = KEYWORDS.filter(k => k.length > 2);
const lower = c => { const l = c.toLowerCase(); return [...l][0]; };
function levenshteinWithMax(s1, s2, maxValue) {
  let previous = new Array(s2.length + 1), current = new Array(s2.length + 1);
  const big = maxValue + 0.01;
  for (let i = 0; i <= s2.length; i++) previous[i] = i;
  for (let i = 1; i <= s1.length; i++) {
    const c1 = s1[i - 1];
    const minJ = Math.max(Math.ceil(i - maxValue), 1);
    const maxJ = Math.min(Math.floor(maxValue + i), s2.length);
    let colMin = i;
    current[0] = i;
    for (let j = 1; j < minJ; j++) current[j] = big;
    for (let j = minJ; j <= maxJ; j++) {
      const substitutionDistance = lower(s1[i - 1]) === lower(s2[j - 1]) ? previous[j - 1] + 0.1 : previous[j - 1] + 2;
      const dist = c1 === s2[j - 1] ? previous[j - 1] : Math.min(previous[j] + 1, current[j - 1] + 1, substitutionDistance);
      current[j] = dist;
      colMin = Math.min(colMin, dist);
    }
    for (let j = maxJ + 1; j <= s2.length; j++) current[j] = big;
    if (colMin > maxValue) return -1;
    [previous, current] = [current, previous];
  }
  const res = previous[s2.length];
  return res > maxValue ? -1 : res;
}
function spellingSuggestion(name) {
  const runes = [...name];
  const maximumLengthDifference = Math.max(2, Math.floor(runes.length * 0.34));
  let bestDistance = Math.floor(runes.length * 0.4) + 0.9;
  let best = null;
  for (const candidate of VIABLE) {
    const maxLen = Math.max(candidate.length, runes.length), minLen = Math.min(candidate.length, runes.length);
    if (maxLen - minLen > maximumLengthDifference) continue;
    if (candidate === name) continue;
    const distance = levenshteinWithMax(runes, [...candidate], bestDistance);
    if (distance < 0) continue;
    if (distance < bestDistance) { bestDistance = distance; best = candidate; }
    else if (best === null || candidate < best) best = candidate;
  }
  return best;
}
function spaceSuggestion(name) {
  for (const keyword of VIABLE) if (name.length > keyword.length + 2 && name.startsWith(keyword)) return keyword + " " + name.slice(keyword.length);
  return null;
}
// name: the text of the identifier (escapes decoded). token: {kind, value} of the token after it, kind one of "{", "=", "other".
// Returns [code, argument or null, "name" | "token" | "name-to-token"]: what the diagnostic marks.
function missingSemicolonAfter(name, token) {
  switch (name) {
    case "const": case "let": case "var": return [1440, null, "name"];
    case "declare": return null;
    case "interface": return token.kind === "{" ? [1438, null, "token"] : [2427, token.value, "token"];
    case "is": return [1228, null, "name-to-token"];
    case "module": case "namespace": return token.kind === "{" ? [1437, null, "token"] : [2819, token.value, "token"];
    case "type": return token.kind === "=" ? [1439, null, "token"] : [2457, token.value, "token"];
  }
  const suggestion = spellingSuggestion(name) ?? spaceSuggestion(name);
  if (suggestion) return [1435, suggestion, "name"];
  return [1434, null, "name"];
}
module.exports = { KEYWORDS, VIABLE, spellingSuggestion, spaceSuggestion, missingSemicolonAfter };
