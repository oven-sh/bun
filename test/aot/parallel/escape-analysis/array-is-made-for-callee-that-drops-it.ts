// A one-element literal is handed to a callee that only reads it and whose inner function declarations capture it: the array and its storage die in the callee.
interface Target { texts: readonly string[] }
interface Lit { value: string }
const emptyArray: readonly number[] = [];
const made: string[] = [];
function literalType(text: string): string { made.length < 4 && made.push(text); return text; }
function inferFromParts(sourceTexts: readonly string[], sourceTypes: readonly number[], target: Target): string[] | undefined {
  const lastSourceIndex = sourceTexts.length - 1;
  const sourceStartText = sourceTexts[0];
  const sourceEndText = sourceTexts[lastSourceIndex];
  const targetTexts = target.texts;
  const lastTargetIndex = targetTexts.length - 1;
  const targetStartText = targetTexts[0];
  const targetEndText = targetTexts[lastTargetIndex];
  if (lastSourceIndex === 0 && sourceStartText.length < targetStartText.length + targetEndText.length || !sourceStartText.startsWith(targetStartText) || !sourceEndText.endsWith(targetEndText)) return undefined;
  const remainingEndText = sourceEndText.slice(0, sourceEndText.length - targetEndText.length);
  const matches: string[] = [];
  let seg = 0;
  let pos = targetStartText.length;
  for (let i = 1; i < lastTargetIndex; i++) {
    const delim = targetTexts[i];
    if (delim.length > 0) {
      let s = seg, p = pos;
      while (true) { p = getSourceText(s).indexOf(delim, p); if (p >= 0) break; s++; if (s === sourceTexts.length) return undefined; p = 0; }
      addMatch(s, p); pos += delim.length;
    } else if (pos < getSourceText(seg).length) addMatch(seg, pos + 1);
    else if (seg < lastSourceIndex) addMatch(seg + 1, 0);
    else return undefined;
  }
  addMatch(lastSourceIndex, getSourceText(lastSourceIndex).length);
  return matches;
  function getSourceText(index: number) { return index < lastSourceIndex ? sourceTexts[index] : remainingEndText; }
  function addMatch(s: number, p: number) {
    const matchType = s === seg ? literalType(getSourceText(s).slice(pos, p)) : literalType([sourceTexts[seg].slice(pos), ...sourceTexts.slice(seg + 1, s), getSourceText(s).slice(0, p)].join("|") + sourceTypes.slice(seg, s).length);
    matches.push(matchType); seg = s; pos = p;
  }
}
function inferTypes(source: Lit, target: Target): string[] | undefined { return inferFromParts([source.value], emptyArray, target); }
const targets: Target[] = [{ texts: ["a", "-", "z"] }, { texts: ["q", "", "x"] }, { texts: ["ab", "z"] }];
const sources: Lit[] = [{ value: "a1-2z" }, { value: "nothing" }, { value: "abcz" }, { value: "q12x" }];
let n = 0;
for (let i = 0; i < 400000; i++) { const r = inferTypes(sources[i & 3], targets[i % 3]); n += r ? r.length : 0; }
console.log(n, made.join());
