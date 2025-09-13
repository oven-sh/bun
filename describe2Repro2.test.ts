import { afterEach, beforeEach, it } from "bun:test";

beforeEach(async () => {
  await 1;
  throw "##123##";
});

afterEach(async () => {
  await 1;
  console.error("#[Test passed successfully]");
});

it("current", async () => {
  await 1;
  throw "##456##";
});
