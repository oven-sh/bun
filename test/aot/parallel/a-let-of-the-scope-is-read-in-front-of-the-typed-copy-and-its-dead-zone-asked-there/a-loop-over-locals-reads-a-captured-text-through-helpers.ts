// The counter and the bound are locals; only the text is captured.
// STATISTIC: CapturedVariableReadsHoisted >= 1
const said: string[] = [];
function tell(what: () => unknown) { try { said.push(String(what())); } catch (error: any) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
function makeReader(first: string) {
  let letters = first;
  let place = 0;
  let limit = first.length;
  let begun = 0;
  let meddler: ((at: number) => void) | undefined;
  function codeAt(at: number) { return letters.charCodeAt(at); }
  function pointAt(at: number) { return letters.codePointAt(at) as number; }
  function skim(quoted: boolean): number {
    begun = place;
    if (place >= limit) return -1;
    for (let code = codeAt(place); place < limit && code !== 10 && code !== 96; code = pointAt(++place)) {
      if (!quoted) {
        if (code === 123) break;
      }
    }
    return place - begun;
  }
  function count(quoted: boolean): number {
    const stop = limit;
    let at = place;
    if (typeof stop !== "number" || typeof at !== "number") return -2;
    for (let code = codeAt(at); at < stop && code !== 10 && code !== 96; code = pointAt(++at)) {
      if (!quoted) {
        if (code === 123) break;
      }
    }
    return at;
  }
  function reset(next: string, from = 0, to = next.length) { letters = next; place = from; limit = to; }
  return { skim, count, reset, where: () => place, meddle(with_: typeof meddler) { meddler = with_; }, what: () => letters };
}
(globalThis as any).kept = makeReader("x");
const reader: ReturnType<typeof makeReader> = (globalThis as any).kept;
const line = "a fairly long line of words without brace or tick, again and again".repeat(3) + "\n";
let sum = 0; for (let turn = 0; turn < 300; turn++) { reader.reset(line); sum += reader.count(turn % 2 === 0); }
tell(() => sum);
console.log(said.join(" | "));
