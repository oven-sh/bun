// A fresh Uint8Array passes a test that reads the type of the cell alone, and a Buffer reads it under its own names: what a Uint8Array is, it stays.
function n(d) { return d.length; }
function g(f, k) { const c = new Uint8Array(k); return f(c); }
console.log(n(Buffer.from([65, 66])), g(n, 4));
