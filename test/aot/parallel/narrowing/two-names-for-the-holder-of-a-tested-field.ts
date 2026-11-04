// two parameters name one object. Behind the test of the tag through the first name the second stores another tag and another value: the layout of the object stays what it was, and every read finds what lies there now
type Hit = { ok: boolean; value: string };

function unwrap(r: Hit, alias: Hit): string {
  if (r.ok) {
    alias.ok = false;
    alias.value = "stored through the other name";
    return r.value + " " + r.ok;
  }
  return "miss " + r.ok;
}

function deed(): string {
  const both: Hit = { ok: true, value: "value" };
  return unwrap(both, both) + " | " + unwrap(both, both);
}

console.log(unwrap({ ok: true, value: "a" }, { ok: true, value: "b" }));
let seen = "";
for (let i = 0; i < 300; i++) seen = unwrap({ ok: i % 2 === 0, value: "a" }, { ok: true, value: "b" });
console.log(seen);
console.log(deed());
for (let i = 0; i < 3; i++) console.log(deed());
