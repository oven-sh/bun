// On a letter seldom met the turn calls a function by value that puts another text, then a number, where the text stood: the guard stays in the turn.
// STATISTIC: InlineeGuardsHoistedPastStores = 0
const said: string[] = [];
function tell(what: () => unknown) { try { said.push(String(what())); } catch (error: any) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
function pointOf(text: string, at: number): number { return text.codePointAt(at) as number; }
function makeReader() {
  var letters: string;
  var place: number;
  var limit: number;
  var begun = 0;
  let meddler: ((at: number) => void) | undefined;
  function codeAt(at: number) { return letters.charCodeAt(at); }
  function pointAt(at: number) { return pointOf(letters, at); }
  function skim(quoted: boolean): number {
    begun = place;
    if (place >= limit) return -1;
    for (let code = codeAt(place); place < limit && code !== 10 && code !== 96; code = pointAt(++place)) {
      if (!quoted) {
        if (code === 123) break;
        if (code === 64 && meddler) meddler(place);
      }
    }
    return place - begun;
  }
  function reset(next: string, from = 0, to = next.length) { letters = next; place = from; limit = to; }
  return { skim, reset, where: () => place, meddle(with_: typeof meddler) { meddler = with_; }, what: () => letters };
}
(globalThis as any).kept = makeReader();
const reader: ReturnType<typeof makeReader> = (globalThis as any).kept;
let calls = 0;
reader.meddle(at => { calls++; reader.reset(calls % 2 ? "zzzzzzzzzzzz{zz" : through(12345), at, 14); });
for (let turn = 0; turn < 8; turn++) tell(() => { reader.reset("abc@defghijklmnop{q"); return reader.skim(false) + ":" + reader.where() + ":" + String(reader.what()).length; });
tell(() => calls);
console.log(said.join(" | "));
