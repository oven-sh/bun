function outer(n: number) {
  const list: unknown[] = [];
  for (let i = 0; i < n; i++) { if (i % 2) list.push(f); else list.push(g); }
  let k = 0;
  while (k++ < 2) list.push(f);
  do { list.push(g); } while (k++ < 4);
  return new Set(list).size + ":" + list.length;
  function f() { return 1; }
  function g() { return 2; }
}
console.log(outer(5), outer(0));
