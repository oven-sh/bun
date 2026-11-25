import { test } from "bun:test";
test("call-apply-bind", () => {
  function add(a, b) { return a + b; }
  const kept = Function.prototype.call;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = String(add.apply(null, [1, turn])) + add.bind(null, 1)(turn) + add.call(null, 1, turn);
  Function.prototype.call = function () { asked++; return 'called'; };
  try {
    for (let turn = 0; turn < 300; turn++) during = String(add.apply(null, [1, turn])) + add.bind(null, 1)(turn) + add.call(null, 1, turn);
  } finally {
    Function.prototype.call = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = String(add.apply(null, [1, turn])) + add.bind(null, 1)(turn) + add.call(null, 1, turn);
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
