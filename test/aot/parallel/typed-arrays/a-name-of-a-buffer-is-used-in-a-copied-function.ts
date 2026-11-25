// The length of a Buffer is found where Uint8Array is written; a name that Buffer makes its own is used in a small function that is copied in front of the loop, in it and behind it.
// PLAIN: 6:2Uint8Array 6:99Buffer 6:2 6:99 6/2 6/99
const leak = (v: any): any => { (globalThis as any).leaked = v; return (globalThis as any).leaked; }, key: any = JSON.parse('"go"');
const head = (x: Uint8Array): Uint8Array => x.slice(1), tail = (x: Uint8Array): Uint8Array => x.subarray(1);
const T: any[] = [
  { go(a: Uint8Array): string { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]!; const b = head(a); b[0] = 99; return s + ":" + a[1] + tail(a).constructor.name; } },
  { go(a: Uint8Array): string { let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]!; if (i + 1 === a.length) head(a)[0] = 99; } return s + ":" + a[1]; } },
  { go(a: Uint8Array): string { const b = head(a); let s = 0; for (let i = 0; i < a.length; i++) s += a[i]!; b[0] = 99; return s + "/" + a[1]; } },
];
let last = "";
for (let r = 0; r < 60; r++) last = T.map(t => [leak(new Uint8Array([1, 2, 3])), leak(Buffer.from([1, 2, 3]))].map(a => { try { return String(t[key](a)); } catch (e) { return (e as Error).name; } }).join(" ")).join(" ");
console.log(last);
export {};
