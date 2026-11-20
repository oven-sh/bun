import { test } from "bun:test";
test("toString() asks what lies under join", () => {
  const builtIn = Array.prototype.join;
  Array.prototype.join = function () { return "joined"; };
  let text = "";
  try {
    for (let turn = 0; turn < 300; turn++) text = [1, 2, turn].toString();
  } finally {
    Array.prototype.join = builtIn;
  }
  console.log(text);
});
