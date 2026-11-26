import { test } from "bun:test";
const said = call => call.then(it => console.log(JSON.stringify(it.default)), error => console.log(error.name));
test("a", async () => {
  await said(import("./data.txt", { with: { type: "toml" } }));
  await said(import("./data.txt", { with: { type: "yaml" } }));
  await said(import("./data.txt", { with: { type: "toml" } }));
  await said(import("./data.txt", { with: { type: "text" } }));
});
