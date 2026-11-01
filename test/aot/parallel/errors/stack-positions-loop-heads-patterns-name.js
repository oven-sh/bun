// Prints where the frame points when the pattern in the head of a loop cannot take a value apart, for keys that are names, quoted, in brackets, and the same as their variable or not.
function placeOf(run) {
  try {
    run();
    return "nothing thrown";
  } catch (error) {
    return /:(\d+:\d+)\)?$/.exec(error.stack.split("\n")[1])[1];
  }
}
// prettier-ignore
console.log(placeOf(() => { for (const { q } of [null]); }));
// prettier-ignore
console.log(placeOf(() => { for (const { q: q } of [null]); }));
// prettier-ignore
console.log(placeOf(() => { for (const { "q": q } of [null]); }));
// prettier-ignore
console.log(placeOf(() => { for (const { ["q"]: q } of [null]); }));
// prettier-ignore
console.log(placeOf(() => { for (const { [`q`]: q } of [null]); }));
// prettier-ignore
console.log(placeOf(() => { for (const { q: other } of [null]); }));
// prettier-ignore
console.log(placeOf(() => { for (const { "q": other } of [null]); }));
// prettier-ignore
console.log(placeOf(() => { for (const { "p": p, "q": q } of [null]); }));
// prettier-ignore
console.log(placeOf(() => { for (const { "p": p, ["q"]: q } of [null]); }));
// prettier-ignore
console.log(placeOf(() => { for (const { "p": { "q": q } } of [{ p: null }]); }));
// prettier-ignore
console.log(placeOf(() => { for (const { "q": q = 1 } of [null]); }));
// prettier-ignore
console.log(placeOf(() => { for (const { "q": q, ...rest } of [null]); }));
