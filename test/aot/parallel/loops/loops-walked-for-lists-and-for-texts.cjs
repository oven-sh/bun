"use strict";
// A name that is a list or a text: the body is walked once for each, and the loop of one walk takes nothing of the other's.
const isList = process.argv.length > 9;
function told(name, make) {
  let answer;
  try {
    answer = JSON.stringify(make());
  } catch (error) {
    answer = error instanceof TypeError ? "TypeError" : String(error);
  }
  console.log(name, answer);
}
function joined(t) { let s = ""; for (const x of t.matchAll(/./g)) s += x; return s; }
function lengths(t) { let n = 0; for (const x of t.matchAll(/./g)) n += x.length; return n; }
function groups(t) { const out = []; for (const m of t.matchAll(/(\w)(\d)/g)) out.push(m[1] + ":" + m[2] + "@" + m.index); return out; }
function first(t) { for (const x of t.matchAll(/b./g)) return x[0] + x.index; return "none"; }
function counted(t) { let n = 0; for (const x of t.matchAll(/[a-c]/g)) { if (x[0] === "b") continue; n++; } return n; }
function broken(t) { let s = ""; for (const x of t.matchAll(/./g)) { if (x[0] === "c") break; s += x[0]; } return s; }
function nested(t) { let s = ""; for (const x of t.matchAll(/./g)) for (const y of t.matchAll(/./g)) s += x[0] + y.length; return s; }
function copied(t) { let s = ""; for (const x of t.matchAll(/./g)) { const y = x; s += y + y; } return s; }
function pieces(t) { let n = 0; for (const x of t.split("b")) n += x.length; return n; }
function rest(t) { let n = ""; for (const x of t.slice(1)) n += x.length; return n; }
function own(t) { let n = 0; for (const x of t) n += x.length; for (const x of t.matchAll(/./g)) n += x.length; return n; }
function twice(t) { let n = 0; for (const x of t.matchAll(/./g)) n += x.length; for (const x of t.matchAll(/../g)) n += x[0].length; return n; }
function thrown(t) { let n = 0; try { for (const x of t.matchAll(/./g)) { n += x.length; if (n > 1) throw new Error("at " + x.index); } } catch (error) { return error.message; } return n; }
const texts = [isList ? ["q"] : "abc", isList ? ["q", "r"] : "a1b2c3", isList ? [] : "", isList ? ["b"] : "bbbb"];
const ways = { joined, lengths, groups, first, counted, broken, nested, copied, pieces, rest, own, twice, thrown };
for (const name of ["joined", "lengths", "groups", "first", "counted", "broken", "nested", "copied", "pieces", "rest", "own", "twice", "thrown"]) {
  for (const t of texts)
    told(name, () => ways[name](t));
}
const list = ["x", "yz"];
list.matchAll = pattern => ["one", "three", String(pattern)];
list.split = () => ["p", "qr"];
told("joined list", () => joined(list));
told("lengths list", () => lengths(list));
told("broken list", () => broken(list));
told("copied list", () => copied(list));
told("twice list", () => twice(list));
told("thrown list", () => thrown(list));
told("own list", () => own(list));
told("pieces list", () => pieces(list));
told("joined without", () => joined(["x"]));
told("lengths text", () => lengths("four"));
list.matchAll = () => "text";
told("joined text of list", () => joined(list));
told("lengths text of list", () => lengths(list));
list.matchAll = () => new Set(["s", "tu"]);
told("joined set of list", () => joined(list));
told("lengths set of list", () => lengths(list));
list.matchAll = () => 5;
told("joined number of list", () => joined(list));
