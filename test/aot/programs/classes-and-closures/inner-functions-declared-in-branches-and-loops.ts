// Inner functions that are only called are not made as objects: what they capture is read from the scope. Here they are declared in branches, in loops and around other code,
// so the scope is filled at several places, and every turn of a loop has functions of its own that see the values of that turn.
// Built without inlining: a call that is taken into its caller hides what the caller believes about the callee.
function inBranches(flag: boolean, n: number) {
  let total = n;
  if (flag) {
    const bonus = n * 10;
    function inBranch(x: number): number {
      total += x;
      return x > 0 ? inBranch(x - 1) : helper(total + bonus);
    }
    return inBranch(n);
  }
  return helper(n);

  function helper(x: number): number {
    total++;
    return x > 100 ? helper(x - 100) : x + total;
  }
}
console.log(inBranches(true, 3), inBranches(false, 3), inBranches(true, 40), inBranches(false, 250));

function everyTurnHasItsOwn(n: number) {
  let log = "";
  const kept: (() => string)[] = [];
  for (let k = 0; k < n; k++) {
    const c = "c" + k;
    function g(depth: number): string {
      return depth > 0 ? g(depth - 1) : c;
    }
    function h(): string {
      return g(1) + "|";
    }
    kept.push(h);
    log += h();
  }
  return log + kept.map(f => f()).join("");
}
console.log(everyTurnHasItsOwn(4));

// The function to call is found before its arguments are computed. While this one waits for its argument, the loop goes on and declares the functions of the next turns.
async function declaredAgainWhileWaiting() {
  const out: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve));
  const waiting: Promise<void>[] = [];
  for (let k = 0; k < 3; k++) {
    const c = "c" + k;
    function g(prefix: string, depth: number): string {
      return depth > 0 ? g(prefix, depth - 1) : prefix + c;
    }
    async function h() {
      out.push(g(await gate.then(() => "p" + k), 1));
    }
    waiting.push(h());
  }
  release();
  await Promise.all(waiting);
  return out.join();
}
console.log(await declaredAgainWhileWaiting());

// A class and a call stand between the declarations' uses, and the call already runs one of the functions.
function aroundOtherCode(seed: number) {
  let steps = 0;
  const early = first(seed);
  class Holder {
    value = second(seed);
    static made = 0;
    constructor() {
      Holder.made++;
    }
  }
  const holder = new Holder();
  return [early, holder.value, Holder.made, third(seed), steps].join();

  function first(x: number): number {
    steps++;
    return x > 2 ? first(x - 2) : second(x);
  }
  function second(x: number): number {
    steps++;
    return x > 5 ? second(x - 5) : x * seed;
  }
  function third(x: number): number {
    steps++;
    return first(x) + second(x);
  }
}
console.log(aroundOtherCode(7), aroundOtherCode(12));

// A generator keeps its scope while it is suspended, and two of them run in turn.
function* counting(from: number) {
  let current = from;
  while (current < from + 3) yield next();

  function next(): number {
    return bump(1);
  }
  function bump(by: number): number {
    current += by;
    return by > 1 ? bump(by - 1) : current * from;
  }
}
const one = counting(1);
const two = counting(10);
console.log([one.next().value, two.next().value, one.next().value, two.next().value, ...one, ...two].join());

let sum = 0;
for (let i = 0; i < 20000; i++) sum += inBranches(i % 3 === 0, i % 11) + everyTurnHasItsOwn(i % 3).length;
console.log(sum);
