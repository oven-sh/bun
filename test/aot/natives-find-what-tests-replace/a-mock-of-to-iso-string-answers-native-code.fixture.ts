import { jest, spyOn, test } from "bun:test";
function written(ms: number) { const date = new Date(ms); return date.toJSON(); }
test("what a mock gives is what native code goes by", () => {
  const spy = spyOn(Date.prototype, "toISOString").mockImplementation((() => "mocked") as any);
  let last: unknown;
  try {
    for (let i = 0; i < 300; i++) last = written(i);
    console.log(spy.mock.calls.length, String(last));
  } finally {
    jest.restoreAllMocks();
  }
  console.log(String(written(1)));
});
