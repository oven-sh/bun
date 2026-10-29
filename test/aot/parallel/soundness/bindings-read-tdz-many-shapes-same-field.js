// A binding that is read as `binding.x` in a file without types is expected to hold one of the shapes of the program with an `x`. Here there are more of them than such a list keeps.
// Each read below comes before the declaration has run, and throws a ReferenceError.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const shapes = [
  { x: 1, a: 0 }, { x: 2, b: 0 }, { x: 3, c: 0 }, { x: 4, d: 0 }, { x: 5, e: 0 }, { x: 6, f: 0 }, { x: 7, g: 0 }, { x: 8, h: 0 }, { x: 9, i: 0 }, { x: 10, j: 0 },
  { x: 11, k: 0 }, { x: 12, l: 0 }, { x: 13, m: 0 }, { x: 14, n: 0 }, { x: 15, o: 0 }, { x: 16, p: 0 }, { x: 17, q: 0 }, { x: 18, r: 0 }, { x: 19, s: 0 }, { x: 20, t: 0 },
];
let sum = 0;
for (const shape of shapes) sum += shape.x;
console.log("shapes", shapes.length, sum);

console.log("const of the module", attempt(() => ofModule.x));
const ofModule = { x: 1 };
console.log("const of the module", attempt(() => ofModule.x));

console.log("let of the module", attempt(() => changed.x));
let changed = { x: 2 };
changed = { x: 3 };
console.log("let of the module", attempt(() => changed.x));

function inFunction() {
  const early = attempt(() => local.x);
  const local = { x: 4 };
  return early + " " + attempt(() => local.x);
}
console.log("const of a function", inFunction());

function letInFunction() {
  const read = () => local.x;
  const early = attempt(read);
  let local = { x: 5 };
  return early + " " + attempt(read);
}
console.log("let of a function", letInFunction());

function afterThrow() {
  let hook;
  function start() { hook = () => late.x; if (JSON.parse("true")) throw new RangeError("midway"); const late = { x: 6 }; return late; }
  attempt(start);
  return attempt(hook);
}
console.log("a function that threw", afterThrow());

function defaults(first = second.x, second = { x: 7 }) { return first + second.x; }
console.log("a parameter", attempt(() => defaults()), attempt(() => defaults(1)));

const hooks = [];
for (let i = 0; i < 2; i++) { hooks[i] = () => each.x + i; if (i === 1) continue; const each = { x: 8 }; }
console.log("a loop", attempt(hooks[0]), attempt(hooks[1]));

function cases(n) { let hook; switch (n) { case 0: hook = () => inCase.x; break; case 1: const inCase = { x: 9 }; hook = () => inCase.x; } return attempt(hook); }
console.log("a switch", cases(0), cases(1));

function* steps() { const read = () => between.x; yield attempt(read); const between = { x: 10 }; yield attempt(read); }
console.log("a generator", [...steps()].join(" "));

let wake;
Promise.resolve().then(() => { console.log("behind an await", attempt(() => behindAwait.x)); wake(); });
await new Promise(resolve => { wake = resolve; });
const behindAwait = { x: 11 };
console.log("behind an await", attempt(() => behindAwait.x));
