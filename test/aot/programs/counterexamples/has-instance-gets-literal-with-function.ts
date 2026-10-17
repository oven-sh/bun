// `literal instanceof Spy` hands the literal to `Symbol.hasInstance`, which sees a new function each time.
declare const console: { log(...a: unknown[]): void };
class Spy { static last: unknown; static [Symbol.hasInstance](x: any) { return Spy.last === (Spy.last = x.m); } }
for (let i = 0; i < 2; i++) console.log({ m: () => 1 } instanceof Spy);
