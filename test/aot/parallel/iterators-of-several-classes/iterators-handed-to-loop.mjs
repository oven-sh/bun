const seen = [];

function may(v) {
  seen.push(typeof v === "object" ? "object:" + v.k : typeof v + ":" + v);
  return v;
}

function step(it) {
  let last;
  for (const v of it) last = may(v);
  return last;
}

class Steps {
  m(it, n) {
    let count = 0;
    for (const v of it) {
      may(v);
      if (++count === n) break;
    }
    return count;
  }
}

function* numbersThenObject(x) {
  yield x;
  yield { k: x + 1 };
}

const x = process.argv.length;
const steps = new Steps();
steps.m([x - x + 1, 1].values(), 9);
steps.m(numbersThenObject(4), 9);
steps.m(new Set([7, 8]).values(), 9);

step([5, 7][Symbol.iterator]());
step(new Map([[1, { k: 2 }]]).entries());
step(new Map([[1, { k: 3 }]]).values());
step(new Map([["a", 3]]).keys());
step(numbersThenObject(9));
step("de"[Symbol.iterator]());

console.log(seen.map(v => (v.startsWith("object:") ? "object" : v)).join(" "));
