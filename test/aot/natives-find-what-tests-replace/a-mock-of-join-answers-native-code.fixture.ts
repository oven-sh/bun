import { jest, spyOn, test } from "bun:test";
function text(a: number, b: number) { const list = [a, b]; return list.toString(); }
test("what a mock gives is what native code goes by", () => {
  const spy = spyOn(Array.prototype, "join").mockImplementation((() => "mocked") as any);
  let last: unknown;
  try {
    for (let i = 0; i < 300; i++) last = text(i, i + 1);
    console.log(spy.mock.calls.length, String(last));
  } finally {
    jest.restoreAllMocks();
  }
  console.log(String(text(1, 2)));
});
