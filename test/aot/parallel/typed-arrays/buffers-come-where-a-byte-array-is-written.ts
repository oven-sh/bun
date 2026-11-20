// Where Uint8Array is written a Buffer, heirs, other views and lists come: lengths and elements in loops, and every other name in the loop, in front of it and behind it.
// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: where the length is believed by the note the weaker test is asked again
const id = (v: any): any => { (globalThis as any).leaked = v; return (globalThis as any).leaked; }, out: string[] = [], log: string[] = [];
class Heir extends Uint8Array {}
class Short extends Uint8Array { get length(): number { log.push("length"); return 1; } }
const F: ((a: Uint8Array, f: () => void) => unknown)[] = [
  a => { let s = 0; for (let i = 0; i < a.length; i++) s = (s + a[i]!) | 0; return s + "/" + a.length; },
  a => { const b = a.subarray(1); let s = 0; for (let i = 0; i < b.length; i++) s = (s + b[i]!) | 0; return s + b.constructor.name; },
  a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]!; const b = a.slice(0, 2); b[0] = 200; return s + ":" + a[0] + b.constructor.name; },
  (a, f) => { let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]!; f(); } return s + "/" + a.length; },
  a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]! + a.indexOf(a[i]!); return s + a.toString(); },
  a => { for (let i = 0; i < a.length; i++) a[i] = a[i]! + 1; a.fill("b" as any, 1); return Array.from(a).join(); },
  a => { let s = 0; for (let i = 0; i < a.length; i++) for (let j = i; j < a.length; j++) s += a[j]!; return s; },
  a => { let s = 0, i = a.length; while (i-- > 0) s = s * 2 + a[i]!; return s + (a.at(-1) as any); },
  a => { let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]!; if (i === 0) (a as any).mark = 1; } return s + String((a as any).mark); },
  a => { let s = 0; for (const x of a) s += x; for (let i = 0; i < a.byteLength; i++) s -= a[i]!; return s; },
];
const given = (): any[] => [new Uint8Array([1, 2, 3]), Buffer.from([1, 2, 3]), Buffer.from("abc"), Buffer.alloc(0), Heir.from([4, 5]), new Short([6, 7]), new Uint8ClampedArray([300, 2]), new Int8Array([-1]), [8, 9], "12", Object.defineProperty(Buffer.from([5, 6]), "length", { value: 1 }), Object.setPrototypeOf(Buffer.from([7, 8]), Uint8Array.prototype), Object.setPrototypeOf(new Uint8Array([7, 8]), Buffer.prototype), Object.assign(Buffer.from([9, 9]), { slice: () => "own" }), new Uint8Array(new ArrayBuffer(2, { maxByteLength: 4 })), Buffer.from(new ArrayBuffer(2)), null, undefined, 5];
for (let r = 0; r < 40; r++) { out.length = 0; for (const f of F) for (const a of given()) { try { out.push(String(id(f)(id(a), () => { log.length = 0; }))); } catch (e) { out.push((e as Error).name); } } }
let h = 7; for (const x of out) for (let i = 0; i < x.length; i++) h = (Math.imul(h, 31) + x.charCodeAt(i)) | 0;
console.log(out.length, h, out.slice(0, 40).join("|"));
export {};
