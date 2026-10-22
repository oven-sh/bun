// Every way a sync iteration runs user code: each kind of code writes a variable of its own, which the function with the loop, pattern or spread reads before and after the step.
let byOpen = 0, byNext = 0, byReturn = 0, byDoneGetter = 0, byValueGetter = 0, byGenerator = 0, byGeneratorEnd = 0, byGeneratorFinally = 0, byThrow = 0;

class Countdown {
  constructor(public from: number) {}
  [Symbol.iterator]() {
    byOpen++;
    let left = this.from;
    return {
      next: () => { byNext++; return left > 0 ? { done: false, value: left-- } : { done: true, value: 0 }; },
      return: () => { byReturn++; return { done: true, value: 0 }; },
    };
  }
}

class ResultWithGetters {
  [Symbol.iterator]() {
    let step = 0;
    return { next() { step++; return { get done() { byDoneGetter++; return step > 2; }, get value() { byValueGetter++; return step; } }; } };
  }
}

function* generate(n: number) { try { for (let i = 0; i < n; i++) { byGenerator++; yield i; } byGeneratorEnd++; } finally { byGeneratorFinally++; } }
function* delegate(n: number) { const before = byGenerator; yield* generate(n); yield byGenerator - before; }
function* catching() { try { yield 1; yield 2; } catch { byThrow++; yield 3; } }

function forOf(xs: Countdown) { const o = byOpen, n = byNext; let seen = 0; for (const x of xs) seen += (byNext - n) * x; return [byOpen - o, byNext - n, seen]; }
function forOfBreak(xs: Countdown) { const n = byNext, r = byReturn; for (const x of xs) { if (x < 3) break; } return [byNext - n, byReturn - r]; }
function forOfThrow(xs: Countdown) { const r = byReturn; try { for (const x of xs) { if (x < 3) throw x; } } catch {} return [byReturn - r]; }
function resultGetters(xs: ResultWithGetters) { const d = byDoneGetter, v = byValueGetter; let seen = 0; for (const x of xs) seen += (byDoneGetter - d) + (byValueGetter - v) + x; return [byDoneGetter - d, byValueGetter - v, seen]; }
function generator(n: number) { const g = byGenerator, e = byGeneratorEnd, f = byGeneratorFinally; let seen = 0; for (const x of generate(n)) seen += (byGenerator - g) + x; return [byGenerator - g, byGeneratorEnd - e, byGeneratorFinally - f, seen]; }
function generatorBreak(n: number) { const e = byGeneratorEnd, f = byGeneratorFinally; for (const x of generate(n)) { if (x === 1) break; } return [byGeneratorEnd - e, byGeneratorFinally - f]; }
function pattern(xs: Iterable<number>) { const o = byOpen, n = byNext, r = byReturn; const [a, b] = xs; return [a, b, byOpen - o, byNext - n, byReturn - r]; }
function patternWithRest(xs: Iterable<number>) { const g = byGenerator, e = byGeneratorEnd; const [a, ...rest] = xs; return [a, rest.length, byGenerator - g, byGeneratorEnd - e]; }
function spreadCall(xs: Iterable<number>) { const n = byNext; const max = Math.max(...xs); return [max, byNext - n]; }
function spreadLiteral(xs: Iterable<number>) { const g = byGenerator; const copy = [...xs]; return [copy.length, byGenerator - g]; }
function either(xs: Iterable<number>) { const n = byNext; let seen = 0; for (const x of xs) seen += (byNext - n) + x; return [byNext - n, seen]; }
function manualThrow() { const t = byThrow; const it = catching(); it.next(); const step = it.throw(new Error("x")); return [step.value, byThrow - t]; }

const log: string[] = [];
for (let round = 0; round < 3; round++) {
  log.push(
    forOf(new Countdown(round + 2)).join(), forOfBreak(new Countdown(5)).join(), forOfThrow(new Countdown(4)).join(), resultGetters(new ResultWithGetters()).join(),
    generator(round + 1).join(), generatorBreak(3).join(), pattern(new Countdown(4)).join(), pattern([round, 2]).join(), patternWithRest(generate(3)).join(),
    spreadCall(new Countdown(3)).join(), spreadLiteral(generate(2)).join(), either(round & 1 ? [1, 2] : new Countdown(2)).join(), either(new Set([round, 9])).join(),
    [...delegate(2)].join(), manualThrow().join(),
  );
}
console.log(log.join("\n"));
console.log(byOpen, byNext, byReturn, byDoneGetter, byValueGetter, byGenerator, byGeneratorEnd, byGeneratorFinally, byThrow);

function makeScope() {
  let captured = 0;
  const iterable = { [Symbol.iterator]() { let i = 0; return { next() { captured += 2; return { done: i++ > 1, value: i }; } }; } };
  function walk() { const before = captured; let seen = 0; for (const x of iterable) seen += (captured - before) * x; return [seen, captured - before]; }
  function destructure() { const before = captured; const [a] = iterable; return [a, captured - before]; }
  return () => walk().concat(destructure()).join();
}
const scopeA = makeScope(), scopeB = makeScope();
console.log(scopeA(), scopeB(), scopeA());
