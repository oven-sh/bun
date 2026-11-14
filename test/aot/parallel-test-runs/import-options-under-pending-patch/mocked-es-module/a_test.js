import { mock, test } from "bun:test";
import { loadCounted, loadThrowing } from "./helper.mjs";

async function importUnderPatch(path, load, options) {
  const { promise, resolve } = Promise.withResolvers();
  const mocked = mock.module(path, async () => {
    await promise;
    return { value: "patch" };
  });
  const imported = load(options).then(
    module => module.value,
    error => error.message,
  );
  resolve();
  await mocked;
  return imported;
}

test("the getters of the options run once", async () => {
  mock.module("./counted.mjs", () => ({ value: "first" }));
  require("./counted.mjs");
  let reads = 0;
  const options = {
    get with() {
      reads++;
    },
  };
  console.log(await importUnderPatch("./counted.mjs", loadCounted, options), reads);
});

test("a getter that throws when it runs again", async () => {
  mock.module("./throwing.mjs", () => ({ value: "first" }));
  require("./throwing.mjs");
  let reads = 0;
  const options = {
    get with() {
      if (++reads > 1) throw new Error("read again");
    },
  };
  console.log(await importUnderPatch("./throwing.mjs", loadThrowing, options), reads);
});
