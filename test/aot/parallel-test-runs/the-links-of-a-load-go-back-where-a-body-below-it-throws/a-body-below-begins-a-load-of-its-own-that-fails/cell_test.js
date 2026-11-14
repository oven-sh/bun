import { test, vi } from "bun:test";
const mock = () => ({ round: 10 });
test("t", async () => {
  vi.doMock("./shapes.mjs", mock);
  const first = await import("./user.mjs"), other = await import("./named.mjs");
  let said = first.member() + " " + other.member();
  vi.doUnmock("./shapes.mjs");
  const second = await import("./user.mjs");
  const asked = await globalThis.asked;
  said += ", " + asked + " " + second.member();
  console.log("SAID", said);
});
