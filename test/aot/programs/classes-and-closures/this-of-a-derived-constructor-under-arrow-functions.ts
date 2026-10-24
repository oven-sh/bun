// `this` of a derived constructor under arrow functions that are made before, in, behind and beside `super()`: each reads what plain Bun reads, or throws what plain Bun throws
function attempt(run: () => unknown): string {
  try { return String(run()); } catch (error) { return (error as Error).constructor.name; }
}
class Base { tag = "base"; constructor(public given?: unknown) {} }

class Behind extends Base { read: () => string; constructor() { super(); this.read = () => this.tag; } }
class Nested extends Base { read: () => () => string; constructor() { super(); this.read = () => () => this.tag; } }
class InLoop extends Base { all: (() => string)[] = []; constructor(n: number) { super(); for (let i = 0; i < n; i++) this.all.push(() => this.tag + i); } }
class InBranch extends Base { read: (() => string) | undefined; constructor(flag: boolean) { super(); if (flag) this.read = () => this.tag; } }
class Before extends Base { early: () => string; constructor() { const early = () => this.tag; super(); this.early = early; } }
class BeforeAndBehind extends Base {
  both: string;
  constructor() { const early = () => this; super(); const late = () => this; this.both = String(early() === late() && late() === this); }
}
class CalledTooEarly extends Base { constructor() { const early = () => this.tag; early(); super(); } }
class InArguments extends Base { constructor() { super(() => this.tag); } }
class CalledByBase extends Base { constructor() { super((() => this.tag)()); } }
// @ts-ignore
class Conditional extends Base { read: () => string; constructor(flag: boolean) { if (flag) super(); this.read = () => this.tag; } }
// @ts-ignore
class ShortCircuit extends Base { constructor(flag: boolean) { const read = () => this.tag; flag && super(); read(); } }
// @ts-ignore
class Ternary extends Base { read: () => unknown; constructor(flag: boolean) { flag ? super(1) : super(2); this.read = () => this.given; } }
// @ts-ignore
class InArrow extends Base { read: () => string; constructor() { const bind = () => { super(); }; bind(); this.read = () => this.tag; } }
// @ts-ignore
class InArrowLate extends Base { constructor(log: string[]) { const bind = () => { super(); }; const read = () => this.tag; log.push(attempt(read)); bind(); log.push(attempt(read)); } }
// @ts-ignore
class Twice extends Base { constructor(log: string[]) { super(1); const read = () => this.given; log.push(attempt(() => { super(2); })); log.push(attempt(read)); } }
// @ts-ignore
class TwiceInARow extends Base { constructor(log: string[]) { super(1); try { super(2); } catch (error) { log.push((error as Error).constructor.name); } const read = () => this.given; log.push(attempt(read)); } }
// @ts-ignore
class InTry extends Base { read: () => string; constructor() { try { super(); } finally { } this.read = () => this.tag; } }
class Thrower { constructor() { throw new RangeError("no"); } }
// @ts-ignore
class CatchesBase extends Thrower { constructor(log: string[]) { try { super(); } catch (error) { log.push((error as Error).constructor.name); } const read = () => this; log.push(attempt(read)); return {}; } }
// @ts-ignore
class Labeled extends Base { constructor(flag: boolean, log: string[]) { out: { if (flag) break out; super(); } const read = () => this.tag; log.push(attempt(read)); if (flag) super(); } }
// @ts-ignore
class InSwitch extends Base { constructor(k: number, log: string[]) { switch (k) { case 0: super(); } const read = () => this.tag; log.push(attempt(read)); if (k !== 0) super(); } }
class ReturnsEarly extends Base { read: (() => string) | undefined; constructor(flag: boolean) { if (flag) return { tag: "other", given: 0, read: undefined } as ReturnsEarly; super(); this.read = () => this.tag; } }
class Replaced { constructor() { return { tag: "replaced" }; } }
class BelowReplaced extends Replaced { declare tag: string; read: () => string; constructor() { super(); this.read = () => this.tag; } }
class BelowArray extends Array<number> { sum: () => number; constructor() { super(); this.push(1, 2, 3); this.sum = () => this.reduce((a, b) => a + b, 0); } }
class BelowError extends Error { describe: () => string; constructor(text: string) { super(text); this.describe = () => this.message + "!"; } }
class WithFields extends Base { field = () => this.tag; read: () => string; constructor() { super(); this.read = () => this.field() + this.tag; } }
class SuperMember extends Base { name() { return "m"; } }
class BelowSuperMember extends SuperMember { read: () => string; constructor() { super(); this.read = () => super.name() + this.tag; } name() { return "n"; } }
class Middle extends Base { middle: () => string; constructor() { super(); this.middle = () => this.tag + (this instanceof Bottom); } }
class Bottom extends Middle { bottom: () => string; constructor() { super(); this.tag = "bottom"; this.bottom = () => this.middle() + this.tag; } }

const log: string[] = [];
console.log(new Behind().read(), new Nested().read()(), new InLoop(3).all.map(f => f()).join(), new InBranch(true).read!(), String(new InBranch(false).read));
console.log(new Before().early(), new BeforeAndBehind().both, attempt(() => new CalledTooEarly()), (new InArguments().given as () => string)(), attempt(() => new CalledByBase()));
console.log(new Conditional(true).read(), attempt(() => new Conditional(false)), attempt(() => new ShortCircuit(true).tag), attempt(() => new ShortCircuit(false)));
console.log(new Ternary(true).read(), new Ternary(false).read(), new InArrow().read());
new InArrowLate(log); new Twice(log); new TwiceInARow(log); new CatchesBase(log);
console.log(new InTry().read(), log.join());
log.length = 0;
new Labeled(false, log); new Labeled(true, log); new InSwitch(0, log); new InSwitch(1, log);
console.log(log.join());
console.log(new ReturnsEarly(false).read!(), new ReturnsEarly(true).tag, new BelowReplaced().read(), new BelowArray().sum(), new BelowError("e").describe());
console.log(new WithFields().read(), new BelowSuperMember().read(), new Bottom().bottom(), new Middle().middle());
