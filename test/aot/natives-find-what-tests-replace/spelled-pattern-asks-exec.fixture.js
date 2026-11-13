import { test } from "bun:test";
test("test() and replace() ask what lies under exec", () => {
  const builtIn = RegExp.prototype.exec;
  let asked = 0;
  RegExp.prototype.exec = function (text) {
    asked++;
    return builtIn.call(this, text);
  };
  let hits = 0;
  let swapped = "";
  try {
    for (let turn = 0; turn < 300; turn++) {
      if (/b+/.test("abbc" + turn)) hits++;
      swapped = ("abbc" + turn).replace(/b+/, "-");
    }
  } finally {
    RegExp.prototype.exec = builtIn;
  }
  console.log(hits, swapped, asked);
});
