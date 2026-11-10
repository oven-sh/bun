// The usual way: three captured variables, the place stored in each turn, the letter read by a helper that calls the method itself.
// STATISTIC: GuessesInCopiesAskedInFrontBehindStoresOfTurns >= 1
const said: string[] = [];
function tell(what: () => unknown) { try { said.push(String(what())); } catch (error: any) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
function makeReader() {
  var letters: string;
  var place: number;
  var limit: number;
  var begun = 0;
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
  function reset(next: string, from = 0, to = next.length) { letters = next; place = from; limit = to; }
  return { skim, reset, where: () => place, meddle(with_: typeof meddler) { meddler = with_; }, what: () => letters };
}
(globalThis as any).kept = makeReader();
const reader: ReturnType<typeof makeReader> = (globalThis as any).kept;
const line = "a fairly long line of words without brace or tick, again and again".repeat(3) + "\n";
let sum = 0; for (let turn = 0; turn < 300; turn++) { reader.reset(line); sum += reader.skim(turn % 2 === 0); }
tell(() => sum); tell(() => reader.where());
console.log(said.join(" | "));
