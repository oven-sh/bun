// A string method calls a member of its pattern with the pattern for `this`. Object.prototype.valueOf under that symbol hands the pattern back, and Array.prototype.reverse does too.
// What is done to the result is done to the pattern.
const show = o => [typeof o.k, String(o.k), o.l, Object.keys(o).join("+"), "k" in o, JSON.stringify(o)].join(" ");
function searchAdds() {
  const o = { k: 1, [Symbol.search]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".search(o);
  back.added = 1;
  return (back === o) + " " + show(o);
}
function searchFreezes() {
  const o = { k: 1, [Symbol.search]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".search(o);
  Object.freeze(back);
  try {
    o.k = 2;
  } catch {}
  return (back === o) + " " + show(o);
}
function searchStoresText() {
  const o = { k: 1, [Symbol.search]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".search(o);
  back.k = "text";
  return (back === o) + " " + show(o);
}
function searchDeletes() {
  const o = { k: 1, [Symbol.search]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".search(o);
  delete back.k;
  return (back === o) + " " + show(o);
}
function searchDefinesGetter() {
  const o = { k: 1, [Symbol.search]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".search(o);
  Object.defineProperty(back, "k", { get: () => "got", configurable: true, enumerable: true });
  return (back === o) + " " + show(o);
}
function matchAdds() {
  const o = { k: 1, [Symbol.match]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".match(o);
  back.added = 1;
  return (back === o) + " " + show(o);
}
function matchFreezes() {
  const o = { k: 1, [Symbol.match]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".match(o);
  Object.freeze(back);
  try {
    o.k = 2;
  } catch {}
  return (back === o) + " " + show(o);
}
function matchStoresText() {
  const o = { k: 1, [Symbol.match]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".match(o);
  back.k = "text";
  return (back === o) + " " + show(o);
}
function matchDeletes() {
  const o = { k: 1, [Symbol.match]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".match(o);
  delete back.k;
  return (back === o) + " " + show(o);
}
function matchDefinesGetter() {
  const o = { k: 1, [Symbol.match]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".match(o);
  Object.defineProperty(back, "k", { get: () => "got", configurable: true, enumerable: true });
  return (back === o) + " " + show(o);
}
function matchAllAdds() {
  const o = { k: 1, [Symbol.matchAll]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".matchAll(o);
  back.added = 1;
  return (back === o) + " " + show(o);
}
function matchAllFreezes() {
  const o = { k: 1, [Symbol.matchAll]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".matchAll(o);
  Object.freeze(back);
  try {
    o.k = 2;
  } catch {}
  return (back === o) + " " + show(o);
}
function matchAllStoresText() {
  const o = { k: 1, [Symbol.matchAll]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".matchAll(o);
  back.k = "text";
  return (back === o) + " " + show(o);
}
function matchAllDeletes() {
  const o = { k: 1, [Symbol.matchAll]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".matchAll(o);
  delete back.k;
  return (back === o) + " " + show(o);
}
function matchAllDefinesGetter() {
  const o = { k: 1, [Symbol.matchAll]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".matchAll(o);
  Object.defineProperty(back, "k", { get: () => "got", configurable: true, enumerable: true });
  return (back === o) + " " + show(o);
}
function replaceAdds() {
  const o = { k: 1, [Symbol.replace]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".replace(o, "x");
  back.added = 1;
  return (back === o) + " " + show(o);
}
function replaceFreezes() {
  const o = { k: 1, [Symbol.replace]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".replace(o, "x");
  Object.freeze(back);
  try {
    o.k = 2;
  } catch {}
  return (back === o) + " " + show(o);
}
function replaceStoresText() {
  const o = { k: 1, [Symbol.replace]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".replace(o, "x");
  back.k = "text";
  return (back === o) + " " + show(o);
}
function replaceDeletes() {
  const o = { k: 1, [Symbol.replace]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".replace(o, "x");
  delete back.k;
  return (back === o) + " " + show(o);
}
function replaceDefinesGetter() {
  const o = { k: 1, [Symbol.replace]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".replace(o, "x");
  Object.defineProperty(back, "k", { get: () => "got", configurable: true, enumerable: true });
  return (back === o) + " " + show(o);
}
function replaceAllAdds() {
  const o = { k: 1, [Symbol.replace]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".replaceAll(o, "x");
  back.added = 1;
  return (back === o) + " " + show(o);
}
function replaceAllFreezes() {
  const o = { k: 1, [Symbol.replace]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".replaceAll(o, "x");
  Object.freeze(back);
  try {
    o.k = 2;
  } catch {}
  return (back === o) + " " + show(o);
}
function replaceAllStoresText() {
  const o = { k: 1, [Symbol.replace]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".replaceAll(o, "x");
  back.k = "text";
  return (back === o) + " " + show(o);
}
function replaceAllDeletes() {
  const o = { k: 1, [Symbol.replace]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".replaceAll(o, "x");
  delete back.k;
  return (back === o) + " " + show(o);
}
function replaceAllDefinesGetter() {
  const o = { k: 1, [Symbol.replace]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".replaceAll(o, "x");
  Object.defineProperty(back, "k", { get: () => "got", configurable: true, enumerable: true });
  return (back === o) + " " + show(o);
}
function splitAdds() {
  const o = { k: 1, [Symbol.split]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".split(o);
  back.added = 1;
  return (back === o) + " " + show(o);
}
function splitFreezes() {
  const o = { k: 1, [Symbol.split]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".split(o);
  Object.freeze(back);
  try {
    o.k = 2;
  } catch {}
  return (back === o) + " " + show(o);
}
function splitStoresText() {
  const o = { k: 1, [Symbol.split]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".split(o);
  back.k = "text";
  return (back === o) + " " + show(o);
}
function splitDeletes() {
  const o = { k: 1, [Symbol.split]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".split(o);
  delete back.k;
  return (back === o) + " " + show(o);
}
function splitDefinesGetter() {
  const o = { k: 1, [Symbol.split]: Object.prototype.valueOf, l: "two" };
  const back = "a-b".split(o);
  Object.defineProperty(back, "k", { get: () => "got", configurable: true, enumerable: true });
  return (back === o) + " " + show(o);
}
function reversed() {
  const o = { k: 1, [Symbol.search]: Array.prototype.reverse, l: "two" };
  const back = "a-b".search(o);
  back.added = 1;
  return (back === o) + " " + show(o);
}
for (const run of [searchAdds, searchFreezes, searchStoresText, searchDeletes, searchDefinesGetter, matchAdds, matchFreezes, matchStoresText, matchDeletes, matchDefinesGetter, matchAllAdds, matchAllFreezes, matchAllStoresText, matchAllDeletes, matchAllDefinesGetter, replaceAdds, replaceFreezes, replaceStoresText, replaceDeletes, replaceDefinesGetter, replaceAllAdds, replaceAllFreezes, replaceAllStoresText, replaceAllDeletes, replaceAllDefinesGetter, splitAdds, splitFreezes, splitStoresText, splitDeletes, splitDefinesGetter, reversed]) {
  let last;
  for (let round = 0; round < 3; round++) last = run();
  console.log(run.name, last);
}
