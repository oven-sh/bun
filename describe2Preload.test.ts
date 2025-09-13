import { test } from "bun:test";
import { beforeAll, afterAll, beforeEach, afterEach } from "bun:test";

beforeAll(() => {
  console.log("test beforeAll");
});

afterAll(() => {
  console.log("test afterAll");
});

beforeEach(() => {
  console.log("test beforeEach");
});

afterEach(() => {
  console.log("test afterEach");
});

test("abc", () => {
  console.log("test abc");
});
test("def", () => {
  console.log("test def");
});
