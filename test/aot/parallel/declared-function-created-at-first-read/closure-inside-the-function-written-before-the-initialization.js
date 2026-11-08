function use(callback) { return callback(); }
function outer(n) {
  function visit() { return () => table.n; }
  const table = { n };
  return use(use(visit));
}
for (let i = 0; i < 4; i++) console.log(outer(i));
