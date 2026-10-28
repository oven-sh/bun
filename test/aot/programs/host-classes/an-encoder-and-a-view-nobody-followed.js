// CALLS+ into operationAOTEncodeTextIntoBytes
// CALLS+ bytesOf operationAOTEncodeTextToBytes
// CALLS+ restOf operationAOTTypedArraySubarrayOfAnyValue
// An encoder and a view that come out of an object nobody followed: the function that was read says which method it is, and the receiver is tested for its class.
const holder = JSON.parse('{"a":1}');
holder.encoder = new TextEncoder();
holder.view = new Uint8Array(64);
function into(text) { const counts = holder.encoder.encodeInto(text, holder.view); return counts.written * 100 + counts.read; }
function bytesOf(text) { const bytes = holder.encoder.encode(text); return bytes.length; }
function restOf(from) { const rest = holder.view.subarray(from); return rest.length; }
globalThis.kept = [into, bytesOf, restOf];
let n = 0;
for (let i = 0; i < 1000; i++) n += into("row" + i) + bytesOf("x" + i) + restOf(i & 63);
console.log(n);
holder.encoder = Object.create(TextEncoder.prototype);
holder.view = Object.create(Uint8Array.prototype);
for (const f of [() => into("a"), () => bytesOf("b"), () => restOf(3)]) { try { console.log(f()); } catch (error) { console.log(error.name); } }
