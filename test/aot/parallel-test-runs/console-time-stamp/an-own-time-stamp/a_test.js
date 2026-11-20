import { test } from "bun:test";
test("a test lays its own", () => {
  const said = [];
  console.timeStamp = value => said.push(value);
  console.timeStamp("x");
  delete console.timeStamp;
  console.log("SAID", said.join(), typeof console.timeStamp);
});
