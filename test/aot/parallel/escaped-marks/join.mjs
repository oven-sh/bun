const foreign = Object.defineProperties({}, JSON.parse("{}"));
function alter(own) {
  const target = foreign.none ?? own;
  target.constructor = { [Symbol.species]: function () { return { made: "text" }; } };
}
const it = [1, 2, 3];
foreign.keep = it;
const s1 = { toJSON() { alter(it); return 1; } };
const s2 = { toJSON() { JSON.stringify(s1); return 1; } };
const s3 = { toJSON() { JSON.stringify(s2); return 1; } };
const s4 = { toJSON() { JSON.stringify(s3); return 1; } };
const s5 = { toJSON() { JSON.stringify(s4); return 1; } };
const s6 = { toJSON() { JSON.stringify(s5); return 1; } };
JSON.stringify(s6);
console.log((() => { try { return it.map(x => x).join(); } catch (e) { return e.name; } })());
