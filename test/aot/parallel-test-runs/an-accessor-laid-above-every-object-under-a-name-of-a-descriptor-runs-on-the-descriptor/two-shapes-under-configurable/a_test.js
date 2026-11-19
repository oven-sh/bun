import { test } from "bun:test";
function weigh(grams) {
  return { grams, tare: 0 };
}
function measure(grams) {
  return { grams, width: 0 };
}
function lay(settings) {
  return Object.defineProperty({}, "scale", settings);
}
function read(settings) {
  return settings.grams;
}
test("the accessor stores a text where the file stores numbers", () => {
  Object.defineProperty(Object.prototype, "configurable", {
    get() {
      if (this && typeof this.grams === "number") this.grams = "heavy";
      return undefined;
    },
    configurable: true,
  });
  let seen = "";
  for (let turn = 0; turn < 300; turn++) {
    const settings = turn & 1 ? weigh(turn) : measure(turn);
    lay(settings);
    seen = String(read(settings) + 1);
  }
  delete Object.prototype.configurable;
  console.log(seen);
});
