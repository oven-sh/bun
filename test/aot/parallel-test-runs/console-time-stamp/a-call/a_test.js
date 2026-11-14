import { test } from "bun:test";
test("a call throws", () => {
  let said = "nothing";
  try { console.timeStamp("x"); } catch (error) { said = String(error); }
  console.log("SAID", said);
});
