// Behind a landing the caller goes on in a copy of its typed code, up to and with the tests for what it held across the call, and joins the typed code behind them.
// Between the call and the tests stand stores to a variable of the module, to a captured variable, to a field and to an array. Each runs once, whichever way the call came back,
// whichever of the two tests fails in the copy, and in the arm that a failed test leads to they have all run already.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let ticks = 0;
let first: Point | null = null;
let second: Point | null = null;
let how = 0;
let hook: any = (n: number) => n;

function damage(target: Point): void {
  if (how === 0) delete (target as any).x;
  else if (how === 1) (target as any).y = "Y";
  else if (how === 2) Object.defineProperty(target, "x", { get: () => -7, configurable: true });
  else Object.setPrototypeOf(target, { extra: 1 });
}

function callee(n: number): number {
  hook(n);
  if (first !== null) damage(first);
  if (second !== null) damage(second);
  return n & 7;
}

function makeHolder(): (p: Point, q: Point, log: number[], n: number) => string {
  let calls = 0;
  return function holder(p: Point, q: Point, log: number[], n: number): string {
    const before = p.x + p.y + q.x + q.y;
    const got = callee(n);
    ticks++;
    calls += 2;
    log.push(got);
    const scaled = got * 3 + ticks;
    const fromSecond = q.y;
    ticks += 10;
    log.push(scaled);
    const fromFirst = p.x;
    calls += 100;
    return before + " " + got + " " + scaled + " " + fromSecond + " " + fromFirst + " " + p.y + " " + q.x + " | " + ticks + " " + calls + " " + log.join();
  };
}

const holder = makeHolder();
for (let round = 0; round < 1600; round++) {
  const p = new Point(round, 1);
  const q = new Point(2, round);
  const strikes = round % 100 === 99;
  const which = ((round + 1) / 100) & 3;
  how = ((round + 1) / 400) | 0;
  if (how > 3) how = 3;
  first = strikes && which !== 1 ? p : null;
  second = strikes && which !== 0 ? q : null;
  const line = holder(p, q, [], round);
  if (strikes || round === 0) console.log(round + ": " + line);
}
