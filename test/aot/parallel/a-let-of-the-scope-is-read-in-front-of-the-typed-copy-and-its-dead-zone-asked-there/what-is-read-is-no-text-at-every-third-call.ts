// At every third call an object with the two methods stands where the text is expected.
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
const sly = { length: 9, charCodeAt(at: number) { return 65 + at; }, codePointAt(at: number) { return at === 5 ? 96 : 65 + at; } };
for (let turn = 0; turn < 12; turn++) tell(() => { reader.reset(turn % 3 === 2 ? through(sly) : "abcdefg{hij", 0, 9); return reader.skim(turn % 2 === 0) + ":" + reader.count(false) + ":" + reader.where(); });
console.log(said.join(" | "));
