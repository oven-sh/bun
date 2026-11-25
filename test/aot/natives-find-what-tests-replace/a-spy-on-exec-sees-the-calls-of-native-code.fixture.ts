import { expect, spyOn, test } from "bun:test";
function uses(text: string) { return text.search(/c+/) + (/b+/.test(text) ? 1 : 0); }
test("a spy sees the calls that native code makes", () => {
  const spy = spyOn(RegExp.prototype, "exec");
  let last: unknown;
  try {
    for (let i = 0; i < 300; i++) last = uses("abcb");
    console.log(spy.mock.calls.length, String(last));
    expect(spy).toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
  console.log(String(uses("abcb")));
});
