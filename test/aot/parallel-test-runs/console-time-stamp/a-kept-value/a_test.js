import { test } from "bun:test";
const { timeStamp } = console;
test("the value is undefined", () => {
  const said = [];
  try { timeStamp("x"); } catch (error) { said.push(String(error)); }
  try { [1].forEach(console.timeStamp); } catch (error) { said.push(String(error)); }
  try { new console.timeStamp("x"); } catch (error) { said.push(String(error)); }
  console.log("SAID", said.join(" | "));
});
