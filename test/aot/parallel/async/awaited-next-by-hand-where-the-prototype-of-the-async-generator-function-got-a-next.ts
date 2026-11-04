// `next` is laid on the object under `prototype` of an async generator function, between two awaited steps that are written by hand: every generator below that object finds the new one, and the engine's again once it is deleted.
async function* ticks(n: number) {
  for (let i = 0; i < n; i++) yield i;
}
const show = (r: any) => String(r.value) + ":" + String(r.done);
async function deed(replaces: boolean) {
  const it = ticks(3);
  const a = await it.next();
  if (replaces) (ticks as any).prototype.next = () => ({ value: "replaced", done: false });
  const b = await it.next();
  const c = await it.next();
  return show(a) + " " + show(b) + " " + show(c);
}
console.log(await deed(false));
for (let i = 0; i < 3; i++) console.log(await deed(false));
console.log(await deed(true));
console.log(await deed(false));
delete (ticks as any).prototype.next;
console.log(await deed(false));
