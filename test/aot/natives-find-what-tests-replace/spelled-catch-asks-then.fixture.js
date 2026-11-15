import { test } from "bun:test";
test("catch() asks what lies under then", () => {
  const builtIn = Promise.prototype.then;
  let asked = 0;
  Promise.prototype.then = function (kept, broken) {
    asked++;
    return builtIn.call(this, kept, broken);
  };
  const settled = Promise.resolve(1);
  const ignore = () => {};
  try {
    for (let turn = 0; turn < 300; turn++) settled.catch(ignore);
  } finally {
    Promise.prototype.then = builtIn;
  }
  console.log(asked);
});
