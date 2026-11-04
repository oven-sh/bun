// the holder is one of two layouts and every writer of the tag is in sight. Behind the test a call stores another tag into the very object: it keeps its layout, and each read finds what lies there now
// Under: --aot-testing=CheckProofsAtRunTime: what arrives at the field of the tag
type Hit = { ok: boolean; value: string };
type Miss = { ok: false; error: string };

function clear(r: Hit | Miss): void { r.ok = false; }
function unwrap(r: Hit | Miss): string {
  if (r.ok) {
    clear(r);
    return (r as Hit).value + " " + r.ok;
  }
  return "miss " + (r as Miss).error + " " + (r as Hit).value;
}

function deed(): string {
  const hit: Hit = { ok: true, value: "value" };
  const miss: Miss = { ok: false, error: "error" };
  return unwrap(hit) + " | " + unwrap(hit) + " | " + unwrap(miss);
}

let seen = "";
for (let i = 0; i < 300; i++) seen = unwrap(i % 2 ? { ok: true, value: "a" + i } : { ok: false, error: "e" + i });
console.log(seen);
for (let i = 0; i < 3; i++) console.log(deed());
