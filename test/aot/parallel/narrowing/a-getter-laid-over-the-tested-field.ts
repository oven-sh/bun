// a getter is laid over the field that tells the members of a union apart: each read of the tag runs it, and it answers otherwise each time
type Hit = { ok: true; value: string };
type Miss = { ok: false; error: string };

function unwrap(r: Hit | Miss): unknown {
  if (r.ok) return r.value;
  return r.error;
}

let reads = 0;
function deed(r: Hit | Miss) {
  Object.defineProperty(r, "ok", { get() { return ++reads % 2 === 1; }, configurable: true });
}

const hit: Hit = { ok: true, value: "value" };
const miss: Miss = { ok: false, error: "error" };
console.log(String(unwrap(hit)), String(unwrap(miss)));
let seen = "";
for (let i = 0; i < 300; i++) seen = String(unwrap(i % 2 ? hit : miss));
console.log(seen);
deed(miss);
console.log(String(unwrap(miss)), reads);
for (let i = 0; i < 3; i++) console.log(String(unwrap(miss)), reads);
console.log(String(unwrap(hit)), Object.keys(miss).join());
