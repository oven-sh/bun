// A value that is a Uint8Array or a Buffer is read under both names in one loop.
const U: any = Uint8Array.prototype.slice;
function f(x: any): any { const u: Uint8Array = x, b: Buffer = x; let s = 0, t = 0; for (let i = 0; i < u.length; i++) { s += u[i]; t += b.slice === U ? 1 : 0; s += b[i]; } return s + "/" + t; }
const list: any[] = [Buffer.from([1, 2, 3]), new Uint8Array([1, 2, 3])];
for (const v of list) console.log(f(v));
