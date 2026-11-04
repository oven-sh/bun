async function outer(n: number) {
  const a = f;
  await null;
  const b = f;
  const c = await Promise.resolve().then(() => f);
  return (a === b && b === c) + ":" + f() + ":" + [...steps()].every(x => x === g);
  function f() { return n; }
  function g() {}
  function* steps() { yield g; yield g; }
}
outer(4).then(console.log);
