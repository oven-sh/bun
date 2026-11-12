// Callbacks that are written in place and copied in loops read and store captured variables, for several elements, in every order; before its declaration too.
// STATISTIC: ListCallbacksCopiedWithCalls >= 4
const said: string[] = [];
function tell(what: () => unknown) { try { said.push(String(what())); } catch (error: any) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
function make(how: number) {
  let letters: string = through("abcdefgh");
  let count = 0;
  let late: any = how === 5 ? undefined : how;
  function codeAt(at: number) { return letters.charCodeAt(at); }
  function grow(by: string) { letters = letters + by; return letters.length; }
  function run(): string {
    let sum = 0;
    for (let turn = 0; turn < 7; ++turn) {
      sum += codeAt(turn);
      if (how === 0) [1, 2, 3].forEach(x => { letters = letters.slice(1) + String.fromCharCode(97 + x + turn); sum += codeAt(0); });
      else if (how === 1) sum += [1, 2, 3].map(x => { count = count + x; return count * codeAt(x); }).reduce((a, b) => a + b, count);
      else if (how === 2) { if ([4, 5, 6].some(x => { letters = grow("z" + x) > 12 ? "qrstuvwxyz" : letters; return codeAt(1) > 150; })) sum++; }
      else if (how === 3) sum += [1, 2].filter(x => { count += codeAt(x); return count % 2 === x % 2; }).length;
      else if (how === 4) [1, 2, 3].forEach(x => { if (x === 2) { const before = letters; letters = "b" + letters.slice(1); sum += before.charCodeAt(0) - codeAt(0); } else sum += codeAt(x); });
      else [3, 2, 1].forEach(x => { late = (late ?? 0) + x; sum += late + codeAt(x); });
      sum += codeAt(0) + count;
    }
    return sum + ":" + letters + ":" + count + ":" + late;
  }
  return run;
}
for (const how of [0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5]) { (globalThis as any).kept = make(how); tell(() => (globalThis as any).kept()); }
// The dead zone: the variable is read by the callback before and behind its declaration.
function dead(how: number): string {
  let out = "";
  for (let turn = 0; turn < 3; turn++) {
    try {
      [1, 2].forEach(x => { if (how === 0) out += later; out += x; });
    } catch (error: any) { out += error.constructor.name; }
    let later = "L" + turn;
    [1, 2].forEach(x => { later = later + x; out += later; });
  }
  return out;
}
tell(() => dead(0)); tell(() => dead(1));
// Nested copies: the inner callback stores what the outer loop reads.
function nested(rows: number[][]): number {
  let best = 0, seen = 0;
  for (let turn = 0; turn < 3; turn++) rows.forEach(row => row.forEach(x => { seen++; if (x * seen > best) best = Math.max(best, x * seen); }));
  return best * 1000 + seen;
}
tell(() => nested([[1, 2], [], [9, 1, 4]]));
console.log(said.join("\n"));
