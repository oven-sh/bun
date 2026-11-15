function outer(n) {
  const out = [];
  let step = 0;
  const base = { n };
  function run(action) { return action(); }
  function visit() { return base.n + ":" + step; }
  function ask() { step++; return run(visit); }
  for (let i = 0; i < 3; i++) out.push(ask());
  return out.join();
}
console.log(outer(7));
