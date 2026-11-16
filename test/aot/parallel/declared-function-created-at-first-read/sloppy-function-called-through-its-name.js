function outer(n) {
  const base = { n };
  return visit() + ":" + (visit === visit);
  function visit() { return base.n + typeof this; }
}
for (let i = 0; i < 3; i++) console.log(outer(i));
