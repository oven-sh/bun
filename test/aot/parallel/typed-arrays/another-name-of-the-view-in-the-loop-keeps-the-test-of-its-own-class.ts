// STATISTIC: TypedArrayLengthGuardsAllowingSubclasses = 1
// The front of a loop over a written Uint8Array takes a Buffer for the LENGTH alone. Where the loop uses another name off the same view it asks as before, so that a view made by Uint8Array itself
// keeps what is known of its other names: of the two loops here one has the weaker test.
function lengthAlone(a: Uint8Array): number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]!; return s; }
function anotherName(a: Uint8Array): number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]! + a.byteOffset; return s; }
for (let turn = 0; turn < 3; turn++) console.log(lengthAlone(new Uint8Array([1, 2, 3])), lengthAlone(Buffer.from([4, 5])), anotherName(new Uint8Array([1, 2, 3]).subarray(1)), anotherName(Buffer.from([4, 5, 6]).subarray(2)));
