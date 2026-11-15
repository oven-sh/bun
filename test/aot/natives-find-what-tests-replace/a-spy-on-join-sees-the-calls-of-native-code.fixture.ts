import { expect, spyOn, test } from "bun:test";
function text(a: number, b: number) { const list = [a, b]; return list.toString(); }
test("a spy sees the calls that native code makes", () => {
  const spy = spyOn(Array.prototype, "join");
  let last: unknown;
  try {
    for (let i = 0; i < 300; i++) last = text(i, i + 1);
    console.log(spy.mock.calls.length, String(last));
    expect(spy).toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
  console.log(String(text(1, 2)));
});
