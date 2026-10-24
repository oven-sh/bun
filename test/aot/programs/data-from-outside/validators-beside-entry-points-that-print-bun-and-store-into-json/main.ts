// JSON.parse<T>(text) and validate<T>(value) answer what they answer in an executable of their own, whatever its further entry points hold. These print `Bun`, the global object and a module that a loader found, and store into `JSON` and `Bun.JSON`. None of them runs.
import { JSON, type Schema } from "bun";
import { validate } from "bun:bundle";

type Order = { id: number; tags: string[]; state: "open" | "closed" };

function attempt(name: string, run: () => unknown) {
  try {
    console.log(name, "takes", JSON.stringify(run()));
  } catch (error) {
    for (const issue of (error as Schema.Error).issues) console.log(name, "refuses at", JSON.stringify(issue.path), "for", issue.code);
  }
}

for (const text of [
  '{"id":1,"tags":["a"],"state":"open"}',
  '{"id":"1","tags":["a"],"state":"open"}',
  '{"id":1,"tags":[2],"state":"open"}',
  '{"id":1,"tags":[],"state":"lost"}',
  "[]",
]) {
  attempt("JSON.parse", () => JSON.parse<Order>(text));
  attempt("Bun.JSON.parse", () => Bun.JSON.parse<Order>(text));
  attempt("validate", () => validate<Order>(globalThis.JSON.parse(text)));
}
