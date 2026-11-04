// `next` is called three times on an async generator without waiting, and then a fourth step is awaited by hand: the requests are answered in their order.
const log: string[] = [];
async function* ticks(n: number): AsyncGenerator<number, string, unknown> {
  for (let i = 0; i < n; i++) {
    await null;
    log.push("sent " + String(yield i));
  }
  return "over";
}
const show = (r: IteratorResult<unknown, unknown>) => String(r.value) + ":" + String(r.done);
async function deed(n: number) {
  const it = ticks(n);
  const first = it.next("a");
  const second = it.next("b");
  const third = it.next("c");
  const fourth = await it.next("d");
  log.push("fourth " + show(fourth));
  return [show(await first), show(await second), show(await third), show(fourth)].join(" ");
}
console.log(await deed(5));
console.log(await deed(2));
for (let i = 0; i < 3; i++) console.log(await deed(i));
console.log(log.join(" | "));
