class Wide extends Float64Array {}
const named: any = new Uint8Array(2); named.extra = 1;
const room = new ArrayBuffer(8, { maxByteLength: 16 });
function describe(view: any): string { const copy = structuredClone(view); let sum = 0; for (let i = 0; i < copy.length; i++) sum += Number(copy[i]); return [copy.constructor.name, copy.length, sum, Object.keys(copy).length, copy.extra].join(" "); }
function ofBytes(view: Uint8Array): string { const copy = structuredClone(view); let sum = 0; for (let i = 0; i < copy.length; i++) sum += copy[i]!; return copy.constructor.name + " " + sum + " " + typeof (copy as any).readUInt8; }
function ofFollowing(view: Int16Array): string { const copy = structuredClone(view); const before = copy.length; (copy.buffer as ArrayBuffer).resize(16); return before + " " + copy.length; }
function handedAway(view: Uint8Array): string { const copy = structuredClone(view, { transfer: [view.buffer] }); return copy.length + " " + view.length; }
console.log(describe(Buffer.from("ab")), "|", describe(new Wide([1.5, 2])), "|", describe(named), "|", describe(new BigInt64Array([5n])), "|", describe(new Uint8Array(new SharedArrayBuffer(4))));
console.log(ofBytes(new Uint8Array([1, 2, 3])), "|", ofBytes(Buffer.from("ab")), "|", ofFollowing(new Int16Array(room)), "|", handedAway(new Uint8Array([7, 8])));
