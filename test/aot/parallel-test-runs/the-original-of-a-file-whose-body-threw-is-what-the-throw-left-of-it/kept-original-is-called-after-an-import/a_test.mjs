import { jest, test, vi } from "bun:test";
void jest;
void vi;
let saved;
test("t", async () => {
  await import("./lib.mjs").catch(error => console.log("SAID first", error.name));
  const lay = jest.mock;
  lay("./lib.mjs", original => {
    saved = original;
    const going = original();
    going.catch(() => {});
    return { other: 20 };
  });
  console.log("SAID behind the call");
  console.log("SAID", await import("./lib.mjs").then(each => "came " + each.other, error => "threw " + error.name));
  console.log("SAID", await saved().then(each => "came " + Object.keys(each).join(), error => "rejected " + error.name));
  console.log("SAID ran", globalThis.ran);
});
