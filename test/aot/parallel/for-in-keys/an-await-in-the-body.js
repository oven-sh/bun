// Each turn of a for-in awaits, and while it waits another job deletes a key that is still to come and collects.
async function walk(o) {
  let text = "";
  for (const k in o) {
    const before = o[k];
    await null;
    text += k + "=" + before + ">" + o[k] + (k in o ? "+" : "-") + " ";
  }
  return text;
}
async function deed() {
  const o = { a: 1, b: 2, c: 3, d: 4 };
  const walked = walk(o);
  await null;
  delete o.c;
  o.b = 20;
  Bun.gc(true);
  return walked;
}
console.log(await deed());
for (let i = 0; i < 3; i++) console.log(await walk({ a: i, b: 2 }), "|", await deed());
