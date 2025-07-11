import { test, expect } from "bun:test";

test("test that passes", () => {
  expect(1 + 1).toBe(2);
});

test("another test that passes", () => {
  expect("hello").toBe("hello");
});

test("test that fails", () => {
  expect(1 + 1).toBe(3); // This should fail
});

test("test that is skipped", () => {
  expect(true).toBe(false);
}, { skip: true });

test.todo("test that is todo", () => {
  expect(true).toBe(false);
});