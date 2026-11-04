// the field that tells the members of a union apart is deleted and added again with the other value: the test goes by what the object holds now, and the keys come in their new order
type Hit = { ok: boolean; value: string };
type Miss = { ok: boolean; error: string };

function unwrap(r: Hit | Miss): unknown {
  if (r.ok) return (r as Hit).value;
  return (r as Miss).error;
}

function deed(r: Hit | Miss, ok: boolean) {
  delete (r as any).ok;
  console.log(String(unwrap(r)), Object.keys(r).join());
  r.ok = ok;
}

const hit: Hit = { ok: true, value: "value" };
const miss: Miss = { ok: false, error: "error" };
console.log(String(unwrap(hit)), String(unwrap(miss)));
let seen = "";
for (let i = 0; i < 300; i++) seen = String(unwrap(i % 2 ? hit : miss));
console.log(seen);
deed(hit, false);
console.log(String(unwrap(hit)), Object.keys(hit).join());
for (let i = 0; i < 3; i++) {
  deed(miss, i % 2 === 0);
  console.log(String(unwrap(miss)), Object.keys(miss).join());
}
