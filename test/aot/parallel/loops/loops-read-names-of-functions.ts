// A loop entered for the first time finds the names of a function before its first iteration: it does not go on by name.
// COUNT: operation:operationAOTFillSiteAnswers <= 16
function Plain(): void {}
Plain.a = 1;
Plain.b = 2;
Plain.c = 0.5;
function Maker(this: any): void {
  this.own = 1;
}
(Maker as any).a = 3;
const made = new (Maker as any)();
const arrow: any = () => 1;
arrow.a = 4;
class Holder {
  static a = 5;
}
const loops: ((n: number) => number)[] = [
  n => { let s = 0; for (let i = 0; i < n; i++) s = (s + Plain.a) | 0; return s; },
  n => { let s = 0; for (let i = 0; i < n; i++) s = (s + Plain.b) | 0; return s; },
  n => { let s = 0; for (let i = 0; i < n; i++) s += Plain.c; return s; },
  n => { let s = 0; for (let i = 0; i < n; i++) s = (s + (Maker as any).a) | 0; return s; },
  n => { let s = 0; for (let i = 0; i < n; i++) s = (s + arrow.a) | 0; return s; },
  n => { let s = 0; for (let i = 0; i < n; i++) s = (s + Holder.a) | 0; return s; },
  n => { let s = 0; for (let i = 0; i < n; i++) s = (s + (Plain as any).length + (Plain as any).name.length) | 0; return s; },
  n => { let s = 0; for (let i = 0; i < n; i++) s = (s + ((Plain as any).none === undefined ? 1 : 0)) | 0; return s; },
  n => { let s = 0; for (let i = 0; i < n; i++) s = (s + ((Plain as any).call === Function.prototype.call ? 1 : 0)) | 0; return s; },
  n => { let s = 0; for (let i = 0; i < n; i++) { Plain.a++; s = (s + Plain.a) | 0; } return s; },
];
const turns = Number(process.argv[2] ?? 40);
for (const loop of loops) console.log(loop(turns), made.own);
delete (Plain as any).b;
Object.defineProperty(Plain, "a", { get: () => 7 });
(Function.prototype as any).none = 8;
for (const loop of loops.slice(0, 9)) try { console.log(loop(turns)); } catch (error: any) { console.log(error.constructor.name); }
