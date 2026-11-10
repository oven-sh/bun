// The place comes as a fraction, as a text and as undefined through casts.
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
for (const from of [0.5, "1", undefined, -1, 2 ** 31]) tell(() => { reader.reset("abcdef{gh", through(from), 9); return reader.skim(false) + ":" + reader.where(); });
console.log(said.join(" | "));
