// Eight factories construct one class and store names of their own on the instance, beside a subclass and plain instances.
class Base { kind: number; pos: number; parent: Base | undefined; constructor(kind: number, pos: number) { this.kind = kind; this.pos = pos; this.parent = undefined; } describe() { return 'base ' + this.kind; } }
class Special extends Base { extra: number; constructor(pos: number) { super(-2, pos); this.extra = pos * 2; } }
interface K0 extends Base { a0?: Base | undefined; b0?: number; c0?: string }
interface K1 extends Base { a1?: Base | undefined; b1?: number; c1?: string }
interface K2 extends Base { a2?: Base | undefined; b2?: number; c2?: string }
interface K3 extends Base { a3?: Base | undefined; b3?: number; c3?: string }
interface K4 extends Base { a4?: Base | undefined; b4?: number; c4?: string }
interface K5 extends Base { a5?: Base | undefined; b5?: number; c5?: string }
interface K6 extends Base { a6?: Base | undefined; b6?: number; c6?: string }
interface K7 extends Base { a7?: Base | undefined; b7?: number; c7?: string }
function make0(i: number, p: Base | undefined): K0 { const n = new Base(0, i) as K0; n.parent = p; n.a0 = p; n.b0 = i; n.c0 = 'w'; return n; }
function read0(n: K0): number { return (n.a0 === undefined ? 0 : 1) + (n.b0 ?? 0) + (n.c0 ?? '').length; }
function make1(i: number, p: Base | undefined): K1 { const n = new Base(1, i) as K1; n.parent = p; n.a1 = p; n.b1 = i; n.c1 = 'w'; return n; }
function read1(n: K1): number { return (n.a1 === undefined ? 0 : 1) + (n.b1 ?? 0) + (n.c1 ?? '').length; }
function make2(i: number, p: Base | undefined): K2 { const n = new Base(2, i) as K2; n.parent = p; n.a2 = p; n.b2 = i; n.c2 = 'w'; return n; }
function read2(n: K2): number { return (n.a2 === undefined ? 0 : 1) + (n.b2 ?? 0) + (n.c2 ?? '').length; }
function make3(i: number, p: Base | undefined): K3 { const n = new Base(3, i) as K3; n.parent = p; n.a3 = p; n.b3 = i; n.c3 = 'w'; return n; }
function read3(n: K3): number { return (n.a3 === undefined ? 0 : 1) + (n.b3 ?? 0) + (n.c3 ?? '').length; }
function make4(i: number, p: Base | undefined): K4 { const n = new Base(4, i) as K4; n.parent = p; n.a4 = p; n.b4 = i; n.c4 = 'w'; return n; }
function read4(n: K4): number { return (n.a4 === undefined ? 0 : 1) + (n.b4 ?? 0) + (n.c4 ?? '').length; }
function make5(i: number, p: Base | undefined): K5 { const n = new Base(5, i) as K5; n.parent = p; n.a5 = p; n.b5 = i; n.c5 = 'w'; return n; }
function read5(n: K5): number { return (n.a5 === undefined ? 0 : 1) + (n.b5 ?? 0) + (n.c5 ?? '').length; }
function make6(i: number, p: Base | undefined): K6 { const n = new Base(6, i) as K6; n.parent = p; n.a6 = p; n.b6 = i; n.c6 = 'w'; return n; }
function read6(n: K6): number { return (n.a6 === undefined ? 0 : 1) + (n.b6 ?? 0) + (n.c6 ?? '').length; }
function make7(i: number, p: Base | undefined): K7 { const n = new Base(7, i) as K7; n.parent = p; n.a7 = p; n.b7 = i; n.c7 = 'w'; return n; }
function read7(n: K7): number { return (n.a7 === undefined ? 0 : 1) + (n.b7 ?? 0) + (n.c7 ?? '').length; }
const keep: Base[] = []; let last: Base | undefined = undefined;
for (let i = 0; i < 40; ++i) { let n: Base; switch (i % 10) {
  case 0: n = make0(i, last); break;
  case 1: n = make1(i, last); break;
  case 2: n = make2(i, last); break;
  case 3: n = make3(i, last); break;
  case 4: n = make4(i, last); break;
  case 5: n = make5(i, last); break;
  case 6: n = make6(i, last); break;
  case 7: n = make7(i, last); break;
  case 8: n = new Special(i); break;
  default: n = new Base(-1, i); } keep.push(n); last = n; }
function total(): number { let sum = 0; for (const n of keep) { sum = (sum + n.pos) | 0; switch (n.kind) {
  case 0: sum = (sum + read0(n as K0)) | 0; break;
  case 1: sum = (sum + read1(n as K1)) | 0; break;
  case 2: sum = (sum + read2(n as K2)) | 0; break;
  case 3: sum = (sum + read3(n as K3)) | 0; break;
  case 4: sum = (sum + read4(n as K4)) | 0; break;
  case 5: sum = (sum + read5(n as K5)) | 0; break;
  case 6: sum = (sum + read6(n as K6)) | 0; break;
  case 7: sum = (sum + read7(n as K7)) | 0; break;
} } return sum; }
console.log('late', keep.length, total(), keep[3]!.describe(), keep[8]! instanceof Special, keep[8]! instanceof Base, keep[3]! instanceof Base, Object.keys(keep[3]!).join(','), Object.keys(keep[8]!).join(','), JSON.stringify({ ...keep[9]!, parent: 0 }));
