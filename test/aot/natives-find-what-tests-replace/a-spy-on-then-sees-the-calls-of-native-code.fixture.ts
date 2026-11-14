import { expect, spyOn, test } from "bun:test";
function caught(p: Promise<number>) { p.catch(() => -1); return 1; }
test("a spy sees the calls that native code makes", () => {
  const spy = spyOn(Promise.prototype, "then");
  let last: unknown;
  try {
    for (let i = 0; i < 300; i++) last = caught(Promise.resolve(i));
    console.log(spy.mock.calls.length, String(last));
    expect(spy).toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
  console.log(String(caught(Promise.resolve(1))));
});
