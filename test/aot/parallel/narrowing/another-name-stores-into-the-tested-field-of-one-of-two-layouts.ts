// two parameters name one object, which is one of two layouts, and every writer of the tag is in sight. Behind the test through the first name the second stores another tag
// Under: --aot-testing=CheckProofsAtRunTime: what arrives at the field of the tag
type Hit = { ok: boolean; value: string };
type Miss = { ok: false; error: string };

function unwrap(r: Hit | Miss, alias: Hit | Miss): string {
  if (r.ok) {
    alias.ok = false;
    return (r as Hit).value + " " + r.ok + " " + alias.ok;
  }
  return "miss " + (r as Miss).error + " " + r.ok;
}

function deed(): string {
  const hit: Hit = { ok: true, value: "value" };
  const miss: Miss = { ok: false, error: "error" };
  return unwrap(hit, miss) + " | " + unwrap(hit, hit) + " | " + unwrap(hit, hit) + " | " + unwrap(miss, hit);
}

let seen = "";
for (let i = 0; i < 300; i++) seen = unwrap(i % 2 ? { ok: true, value: "a" + i } : { ok: false, error: "e" + i }, { ok: true, value: "b" });
console.log(seen);
for (let i = 0; i < 3; i++) console.log(deed());
