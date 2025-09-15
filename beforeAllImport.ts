import { beforeAll } from "bun:test";

beforeAll(() => {
  console.log("beforeAll");
});

export function abc() {
  console.log("abc");
}
