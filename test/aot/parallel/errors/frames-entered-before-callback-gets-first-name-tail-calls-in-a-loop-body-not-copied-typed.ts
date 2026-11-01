// As frames-entered-before-callback-gets-first-name-tail-calls-in-a-loop-body-not-copied.mjs, in TypeScript: the function has tests at its entrance, which hand over to its body.
// That hand-over is no tail call of the program's. The one that the program has written still is: what runs above the call is another function object of the same function.
const never = process.argv.length > 1000 ? "x" : "";
type Link = (value: number) => number;
const handedBack = new Function("f", "return f;" + never) as (f: Link) => Link;
const giveDisplayName = new Function("f", "name", "f.displayName = name;" + never) as (f: Link, name: string) => void;
const giveName = new Function("f", "name", "Object.defineProperty(f, 'name', { value: name });" + never) as (f: Link, name: string) => void;
const names = (error: Error, count = 2): string =>
  error
    .stack!.split("\n")
    .slice(1, 1 + count)
    .map(line =>
      line
        .trim()
        .replace(/^at /, "")
        .replace(/ ?\(.*\)$/, ""),
    )
    .join(" < ");
let total = 0;
function chainOf(kept: Error[]) {
  function make(next: Link | null): Link {
    const link = function link(value: number): number {
      let t = 1;
      t = (t * 3 + value) % 1000003;
      t = (t * 5 + value + 1) % 1000003;
      t = (t * 7 + value + 2) % 1000003;
      t = (t * 11 + value + 3) % 1000003;
      t = (t * 13 + value + 4) % 1000003;
      t = (t * 17 + value + 5) % 1000003;
      total += t;
      if (next) return next(value);
      kept.push(new Error(String(value)));
      return value;
    };
    handedBack(link);
    return link;
  }
  const last = make(null);
  const middle = make(last);
  return { first: make(middle), middle, last };
}
function main(give: (f: Link, name: string) => void) {
  const kept: Error[] = [];
  const { first, middle, last } = chainOf(kept);
  for (let index = 0; index < 3; ++index) first(index);
  give(first, "first");
  console.log(names(kept[0]));
  give(last, "last");
  console.log(names(kept[1]));
  give(middle, "middle");
  console.log(names(kept[2]));
  for (let index = 0; index < 1; ++index) first(index);
  console.log(names(kept[3]), total);
}
main(giveDisplayName);
main(giveName);
