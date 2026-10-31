// As frames-entered-before-callback-gets-first-name-tail-calls-in-a-loop.mjs, with a body that is too large to be copied into the loop that calls it.
// The caller keeps the function object that it calls. What runs above the call by then is another function object of the same function, which a tail call has entered.
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
const giveDisplayName = new Function("f", "name", "f.displayName = name;" + never);
const giveName = new Function("f", "name", "Object.defineProperty(f, 'name', { value: name });" + never);
const names = (error, count = 2) =>
  error.stack
    .split("\n")
    .slice(1, 1 + count)
    .map(line =>
      line
        .trim()
        .replace(/^at /, "")
        .replace(/ ?\(.*\)$/, ""),
    )
    .join(" < ");
let total = 0;
function chainOf(kept) {
  function make(next) {
    const link = function link(value) {
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
function main(give) {
  const kept = [];
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
// From the first name on a tail call tells whoever keeps the function object who runs now.
main(giveName);
