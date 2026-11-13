// A loop that only compares the elements of an array with a string skips the elements that are known to differ.
// STATISTIC: SearchLoops >= 4
const log = [];
const id = v => [v][0];
const hide = v => JSON.parse("0", () => v);
let calls = 0;
const loud = { toString() { calls++; return "ab"; } };
const words = ["a", "b", "ab", "length", "x1", "name", "", "value"];
const made = [id("a") + id("b"), id("xaby").slice(1, 3), "ab", "日本", id("日") + "本", "жб", String(id(12)), "12", "abc"];
const mixed = ["q", 1, "1", null, undefined, "ab", loud, "a", 10n, true, Symbol.iterator, ["ab"], "true"];
const holes = ["a", , "b", , "c", "ab"];
const shrinking = ["a", "b", null, "c", "d", "e"];
const restore = () => { shrinking.length = 2; shrinking.push({ toString() { calls += 100; shrinking.length = 3; return "none"; } }, "c", "d", "e"); };
restore();
function existsInWords(list, x) { for (var i = 0; i < list.length; i++) { if (list[i] == x) return true; } return false; }
function placeInWords(list, x) { let at = -1; for (let i = 0, n = list.length; i < n; i++) { if (list[i] === x) { at = i; break; } } return at; }
function countInWords(list, x) { let found = 0; for (let i = 0; i < list.length; i++) if (x === list[i]) found++; return found; }
function fromInWords(list, x, start, end) { for (let i = start; i < end; i++) if (list[i] == x) return i; return -1; }
function existsInMade(list, x) { for (var i = 0; i < list.length; i++) { if (list[i] == x) return true; } return false; }
function placeInMade(list, x) { let at = -1; for (let i = 0, n = list.length; i < n; i++) { if (list[i] === x) { at = i; break; } } return at; }
function countInMade(list, x) { let found = 0; for (let i = 0; i < list.length; i++) if (x === list[i]) found++; return found; }
function fromInMade(list, x, start, end) { for (let i = start; i < end; i++) if (list[i] == x) return i; return -1; }
function existsInMixed(list, x) { for (var i = 0; i < list.length; i++) { if (list[i] == x) return true; } return false; }
function placeInMixed(list, x) { let at = -1; for (let i = 0, n = list.length; i < n; i++) { if (list[i] === x) { at = i; break; } } return at; }
function countInMixed(list, x) { let found = 0; for (let i = 0; i < list.length; i++) if (x === list[i]) found++; return found; }
function fromInMixed(list, x, start, end) { for (let i = start; i < end; i++) if (list[i] == x) return i; return -1; }
function existsInHoles(list, x) { for (var i = 0; i < list.length; i++) { if (list[i] == x) return true; } return false; }
function placeInHoles(list, x) { let at = -1; for (let i = 0, n = list.length; i < n; i++) { if (list[i] === x) { at = i; break; } } return at; }
function countInHoles(list, x) { let found = 0; for (let i = 0; i < list.length; i++) if (x === list[i]) found++; return found; }
function fromInHoles(list, x, start, end) { for (let i = start; i < end; i++) if (list[i] == x) return i; return -1; }
function existsInShrinking(list, x) { for (var i = 0; i < list.length; i++) { if (list[i] == x) return true; } return false; }
function placeInShrinking(list, x) { let at = -1; for (let i = 0, n = list.length; i < n; i++) { if (list[i] === x) { at = i; break; } } return at; }
function countInShrinking(list, x) { let found = 0; for (let i = 0; i < list.length; i++) if (x === list[i]) found++; return found; }
function fromInShrinking(list, x, start, end) { for (let i = start; i < end; i++) if (list[i] == x) return i; return -1; }
const sought = ["ab", "a", id("a") + id("b"), id("xlengthy").slice(1, 7), "", "nothing", "1", "12", "日本", "name", 1, 12, null, undefined, loud, ["ab"], new String("ab"), true, 10n, Symbol.iterator];
const attempt = f => { try { log.push(f()); } catch (e) { log.push(e.name + ": " + e.message); } };
for (const known of sought) {
    const x = hide(known);
    attempt(() => [existsInWords(words, x), placeInWords(words, x), countInWords(words, x), fromInWords(words, x, 0, words.length), fromInWords(words, x, 2, 99), fromInWords(words, x, -2, 4)].join());
    attempt(() => [existsInMade(made, x), placeInMade(made, x), countInMade(made, x), fromInMade(made, x, 0, made.length), fromInMade(made, x, 2, 99), fromInMade(made, x, -2, 4)].join());
    attempt(() => [existsInMixed(mixed, x), placeInMixed(mixed, x), countInMixed(mixed, x), fromInMixed(mixed, x, 0, mixed.length), fromInMixed(mixed, x, 2, 99), fromInMixed(mixed, x, -2, 4)].join());
    attempt(() => [existsInHoles(holes, x), placeInHoles(holes, x), countInHoles(holes, x), fromInHoles(holes, x, 0, holes.length), fromInHoles(holes, x, 2, 99), fromInHoles(holes, x, -2, 4)].join());
    attempt(() => [existsInShrinking(shrinking, x), placeInShrinking(shrinking, x), countInShrinking(shrinking, x), fromInShrinking(shrinking, x, 0, shrinking.length), fromInShrinking(shrinking, x, 2, 99), fromInShrinking(shrinking, x, -2, 4)].join());
    restore();
}
log.push(calls);
console.log(log.join("\n"));
