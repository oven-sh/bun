const out: string[] = [];
const world = globalThis as any;
world.count = 0;
world.next = () => ++world.count;
world.keysOf = (half: object) => Object.keys(half).join();
class Late { first: unknown = world.next(); second: unknown = null; third: unknown = null; fourth: unknown = undefined; fifth = 0; }
class Looked { first: unknown = world.next(); second: unknown = null; third: unknown = null; seen: unknown = world.keysOf(this); fourth: unknown = null; fifth: unknown = null; }
class Bare { declare x?: unknown; declare y?: unknown; declare z?: unknown; }
class Long { a: unknown = world.next(); b: unknown = 1; c: unknown = 2; d: unknown = 3; e: unknown = 4; f: unknown = 5; g: unknown = 6; h: unknown = 7; i: unknown = 8; j: unknown = 9; k: unknown = 10; l: unknown = 11; m: unknown = 12; n: unknown = 13; o: unknown = 14; p: unknown = 15; q: unknown = 16; r: unknown = 17; }
class Inner { x: unknown = world.next(); y: unknown = 2; }
class Outer { a: unknown = world.next(); inner: Inner = new Inner(); b: unknown = 2; c: unknown = 3; }
class Caught { set middle(value: unknown) { out.push("setter sees " + Object.keys(this).join()); } }
class Under extends Caught { first: unknown = world.next(); second: unknown = null; constructor() { super(); this.middle = 1; (this as any).third = 3; (this as any).fourth = 4; } }
world.makers = {
  late: () => new Late(),
  looked: () => new Looked(),
  two: (value: unknown) => { const a = new Bare(); const b = new Bare(); a.x = value; b.y = value; a.y = value; b.x = value; a.z = value; return [a, b]; },
  turned: (value: unknown, other: boolean) => { const a = new Bare(); world.next(); a.x = value; a.y = value; if (other) a.z = value; return a; },
  long: () => new Long(),
  under: () => new Under(),
  outer: () => new Outer(),
};
const show = (o: any) => Object.keys(o).join() + "|" + JSON.stringify(o, (key, value) => (value === undefined ? "undefined" : value));
for (let i = 0; i < 40; i++) { world.makers.late(); world.makers.looked(); world.makers.two(i); world.makers.turned(i, i % 2 === 0); world.makers.long(); world.makers.outer(); }
out.push(show(world.makers.late()), show(world.makers.looked()));
const [a, b] = world.makers.two("v"); out.push(show(a), show(b));
out.push(show(world.makers.turned("w", true)), show(world.makers.turned("w", false)), show(world.makers.long()), show(world.makers.under()));
const outer = world.makers.outer(); out.push(show(outer), show(outer.inner));
const kept: unknown[] = []; for (let i = 0; i < 20000; i++) kept.push(world.makers.late()); out.push(show(kept[19999]));
console.log(out.join("\n"));
