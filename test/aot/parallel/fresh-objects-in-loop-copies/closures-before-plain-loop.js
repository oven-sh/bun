// Under: --aot-check=Validate: the copies of a loop that begin late know the objects made in front
function pr(l) { let s = l.length + ":"; for (let i = 0; i < l.length && i < 40; i++) s += (i in l ? (Object.is(l[i], -0) ? "-0" : String(l[i])) : "_") + ","; return s; }
function say(x) {
}
function show(l) {
}
function tell(label, v, a, b) {
}
{
  let a = Object.create([0.75, 0.5]);
  let b = [];
  let d = 1;
  let c = 0, p = -1;
  const n = a.length + d;
  tell("k03c.0", say(say(c) + "/" + say(p)), a, b);
  console.log("one", c, String(p), pr(b));
}
{
  let a = [];
  for (let q = 0;q < 20; q++)
    a.push(q);
  let b = [];
  let d = 0.5;
  let c = 0, p = -1;
  const n = a.length + d;
  for (let i = n - 1;i >= 0; i--) {
    p = a[i];
    b[i * 2] = a[i] + 1;
  }
  tell("k03d.0", say(say(c) + "/" + say(p)), a, b);
  console.log("two", c, String(p), pr(b));
}
