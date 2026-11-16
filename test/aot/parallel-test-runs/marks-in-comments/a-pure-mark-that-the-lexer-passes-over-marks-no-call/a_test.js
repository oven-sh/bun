import { expect, test } from "bun:test";

const ran = [];
function note(what) { ran.push(what); }

test("what the lexer passes over marks no call", () => {
  /* @jsx @__PURE__ */ note("jsx");
  /*# sourceMappingURL=a@__PURE__ */ note("sourceMappingURL");
  /* @__PURE__ */ note("marked");
  console.log(ran.join());
  expect(ran.length).toBe(2);
});
