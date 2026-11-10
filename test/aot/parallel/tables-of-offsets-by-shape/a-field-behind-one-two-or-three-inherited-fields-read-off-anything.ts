// STATISTIC: ReceiversToldByTablesOfOffsets >= 3
interface HasV { v: number } interface HasW { w: number } interface HasX { x: number }
class P0 { a0 = 0; }
class P1 extends P0 { a1 = 0; } class P2 extends P1 { a2 = 0; }
class A0 extends P0 { v = 1; x = 100; } class B0 extends P0 { v = 2; w = 200; } class C0 extends P0 { w = 3; x = 300; } class A1 extends P1 { v = 4; x = 400; }
class B1 extends P1 { v = 5; w = 500; } class C1 extends P1 { w = 6; x = 600; } class A2 extends P2 { v = 7; x = 700; } class B2 extends P2 { v = 8; w = 800; }
class C2 extends P2 { w = 9; x = 900; } class A3 extends P0 { v = 10; x = 1000; } class B3 extends P0 { v = 11; w = 1100; } class C3 extends P0 { w = 12; x = 1200; }
class A4 extends P1 { v = 13; x = 1300; } class B4 extends P1 { v = 14; w = 1400; } class C4 extends P1 { w = 15; x = 1500; } class A5 extends P2 { v = 16; x = 1600; }
class B5 extends P2 { v = 17; w = 1700; } class C5 extends P2 { w = 18; x = 1800; } class A6 extends P0 { v = 19; x = 1900; } class B6 extends P0 { v = 20; w = 2000; }
class C6 extends P0 { w = 21; x = 2100; } class A7 extends P1 { v = 22; x = 2200; } class B7 extends P1 { v = 23; w = 2300; } class C7 extends P1 { w = 24; x = 2400; }
class A8 extends P2 { v = 25; x = 2500; } class B8 extends P2 { v = 26; w = 2600; } class C8 extends P2 { w = 27; x = 2700; }
class HolderOfV { it: HasV; constructor(it: HasV) { this.it = it; } }
class HolderOfW { it: HasW; constructor(it: HasW) { this.it = it; } }
class HolderOfX { it: HasX; constructor(it: HasX) { this.it = it; } }
function readV(holder: HolderOfV): number { return holder.it.v; }
function readW(holder: HolderOfW): number { return holder.it.w; }
function readX(holder: HolderOfX): number { return holder.it.x; }
Object.assign(globalThis, { readV, readW, readX, A5 });
const outside: ((holder: unknown) => number)[] = (0, eval)("[(holder) => readV(holder), (holder) => readW(holder), (holder) => readX(holder)]");
const things: any[] = (0, eval)("[{ w: 1 }, { v: 100, x: 3 }, { get v() { return 200; } }, Object.create(new A5()), 'text', 7]");
for (let round = 0; round < 8; round++) things.push(new A0(), new B0(), new C0(), new A1(), new B1(), new C1(), new A2(), new B2(), new C2(), new A3(), new B3(), new C3(), new A4(), new B4(), new C4(), new A5(), new B5(), new C5(), new A6(), new B6(), new C6(), new A7(), new B7(), new C7(), new A8(), new B8(), new C8(), new P0(), new P1(), new P2());
const grown: any = new A7(); grown.more = 1; delete grown.a0; things.push(grown);
const emptied: any = new B8(); delete emptied.v; things.push(emptied, Object.freeze(new C6()));
const changed: any = new A1(); Object.defineProperty(changed, "v", { get() { return 300; } }); things.push(changed);
let sum = 0;
for (const thing of things) sum += Number(outside[0](new HolderOfV(thing)) ?? 3) + Number(outside[1](new HolderOfW(thing)) ?? 5) + Number(outside[2](new HolderOfX(thing)) ?? 7);
console.log(sum);
