const log: string[] = [];
function outer(seed: number) {
  const note = (s: string) => { log.push(s); return seed; };
  function* declared(a: number) { log.push("started " + a); const got: unknown = yield a; log.push("got " + got); try { yield a + 1; } finally { log.push("closed"); } }
  const inConst = function* (a: number) { yield a; yield* declared(a + 10); };
  const it = declared(note("argument"));
  log.push("made");
  const first = it.next(), second = it.next("x"), third = it.return(7);
  const all = [...inConst(1)];
  return [first.value, second.value, third.value, third.done, all.join("/"), declared(1) === declared(1), typeof it[Symbol.iterator]].join(",");
}
console.log(outer(3), log.join("|"));
