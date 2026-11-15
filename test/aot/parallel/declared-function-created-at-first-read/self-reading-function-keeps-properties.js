"use strict";
function outer(n) {
  const base = { n };
  return count() + count() + count() + ":" + count.calls + ":" + base.n;
  function count() { count.calls = (count.calls || 0) + 1; return count.calls; }
}
for (let i = 0; i < 3; i++) console.log(outer(i));
