import { expect, spyOn, test } from "bun:test";
function written(ms: number) { const date = new Date(ms); return date.toJSON(); }
test("a spy sees the calls that native code makes", () => {
  const spy = spyOn(Date.prototype, "valueOf");
  let last: unknown;
  try {
    for (let i = 0; i < 300; i++) last = written(i);
    console.log(spy.mock.calls.length, String(last));
    expect(spy).toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
  console.log(String(written(1)));
});
