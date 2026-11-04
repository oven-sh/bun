// the holder is one of two layouts and every writer of the tag is in sight. Between the test and the use stands an await, and another async function stores another tag meanwhile
// Under: --aot-testing=CheckProofsAtRunTime: what arrives at the field of the tag
type Hit = { ok: boolean; value: string };
type Miss = { ok: false; error: string };

async function clearSoon(r: Hit | Miss): Promise<void> { await null; r.ok = false; }
async function unwrap(r: Hit | Miss): Promise<string> {
  if (r.ok) {
    await null;
    await null;
    return (r as Hit).value + " " + r.ok;
  }
  return "miss " + (r as Miss).error + " " + (r as Hit).value;
}

async function deed(): Promise<string> {
  const hit: Hit = { ok: true, value: "value" };
  const miss: Miss = { ok: false, error: "error" };
  const first = unwrap(hit);
  const cleared = clearSoon(hit);
  const parts = [await first, await unwrap(hit), await unwrap(miss)];
  await cleared;
  return parts.join(" | ");
}

let seen = "";
for (let i = 0; i < 100; i++) seen = await unwrap(i % 2 ? { ok: true, value: "a" + i } : { ok: false, error: "e" + i });
console.log(seen);
for (let i = 0; i < 3; i++) console.log(await deed());
