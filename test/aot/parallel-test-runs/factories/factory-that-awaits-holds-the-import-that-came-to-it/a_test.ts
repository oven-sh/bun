// The import() comes to a module whose factory awaits: it waits for that promise, and reader.ts runs behind it, linked to what the factory gave.
import { mock, test } from "bun:test";

mock.module("./who", async () => {
  console.log("factory begins");
  await new Promise(resolve => setTimeout(resolve, 10));
  console.log("factory ends");
  return { who: "mock" };
});

test("the import waits for the factory", async () => {
  const reader = await import("./reader");
  console.log("reader says", reader.read());
});
