import { expect, spyOn, test } from "bun:test";
function own() { const a = new Set([1, 2]), b = new Set([2, 3, 4]); return a.isSubsetOf(b); }
test("a spy sees the calls that native code makes", () => {
  const spy = spyOn(Set.prototype, "has");
  let last: unknown;
  try {
    for (let i = 0; i < 300; i++) last = own();
    console.log(spy.mock.calls.length, String(last));
    expect(spy).toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
  console.log(String(own()));
});
