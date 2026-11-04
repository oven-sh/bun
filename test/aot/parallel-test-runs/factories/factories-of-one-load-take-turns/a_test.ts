// One load comes to three mocked modules whose factories await. They run one at a time, in the order of the import statements: the next is called when the one before has settled.
import { mock, test } from "bun:test";

const factoryOf = (name: string) => async () => {
  console.log(name, "begins");
  await new Promise(resolve => setTimeout(resolve, 5));
  console.log(name, "ends");
  return { name: "mock " + name };
};
mock.module("./one", factoryOf("one"));
mock.module("./two", factoryOf("two"));
mock.module("./three", factoryOf("three"));

test("the load goes on behind the last of them", async () => {
  console.log((await import("./top")).names());
});
