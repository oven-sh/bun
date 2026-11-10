import { jest, spyOn, test } from "bun:test";
function own() { const a = new Set([1, 2]), b = new Set([2, 3, 4]); return a.isSubsetOf(b); }
test("what a mock gives is what native code goes by", () => {
  const spy = spyOn(Set.prototype, "has").mockImplementation((() => true) as any);
  let last: unknown;
  try {
    for (let i = 0; i < 300; i++) last = own();
    console.log(spy.mock.calls.length, String(last));
  } finally {
    jest.restoreAllMocks();
  }
  console.log(String(own()));
});
