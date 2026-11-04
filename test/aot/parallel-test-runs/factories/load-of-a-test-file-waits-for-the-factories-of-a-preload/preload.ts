import { mock } from "bun:test";

const factoryOf = (name: string) => async () => {
  console.log(name, "begins");
  await new Promise(resolve => setTimeout(resolve, 5));
  console.log(name, "ends");
  return { name: "mock " + name };
};
mock.module("./one", factoryOf("one"));
mock.module("./two", factoryOf("two"));
