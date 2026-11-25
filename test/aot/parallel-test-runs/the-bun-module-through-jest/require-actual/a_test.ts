import { jest, test } from "bun:test";

test("it is the global object", () => {
  const actual = jest.requireActual("bun");
  console.log(actual === Bun, jest.requireActual("bun") === actual, typeof actual.file);
});

test("a name of it is called", () => {
  console.log(jest.requireActual("bun").escapeHTML("<b>"));
});
