import { expect, test } from "bun:test";
test("the whole is asked twice", async () => {
  const blob = new Blob([new TextEncoder().encode(JSON.stringify({ name: "Zoë" }))]);
  const first = (await blob.json()).name;
  await blob.slice(0, 1).text();
  const second = (await blob.json()).name;
  console.log("SAID", first, second);
  expect([first, second]).toEqual(["Zoë", "Zoë"]);
});
