import { jest, test, vi } from "bun:test";
test("t", async () => {
  const said = [require("./k.mjs").word()];
  vi.doMock("./g.cjs", () => {
    const actual = jest.requireActual("./g.cjs");
    return { word: "own over " + actual.word, same: actual === globalThis.got };
  });
  const own = require("./g.cjs");
  said.push(own.word, own.same);
  vi.doUnmock("./g.cjs");
  said.push(require("./g.cjs").word, require("./g.cjs") === globalThis.got, Object.prototype.toString.call(require("./g.cjs")));
  console.log("SAID " + said.join(" ") + " " + (globalThis.runs ?? 0));
});
