import { test } from "bun:test";
test("toJSON() asks what lies under toISOString", () => {
  const builtIn = Date.prototype.toISOString;
  Date.prototype.toISOString = function () { return "mocked"; };
  let text = "";
  try {
    for (let turn = 0; turn < 300; turn++) text = new Date(turn).toJSON();
  } finally {
    Date.prototype.toISOString = builtIn;
  }
  console.log(text);
});
