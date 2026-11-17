import { jest, spyOn, test } from "bun:test";
function uses(text: string) { return text.search(/c+/) + (/b+/.test(text) ? 1 : 0); }
test("what a mock gives is what native code goes by", () => {
  const spy = spyOn(RegExp.prototype, "exec").mockImplementation((() => null) as any);
  let last: unknown;
  try {
    for (let i = 0; i < 300; i++) last = uses("abcb");
    console.log(spy.mock.calls.length, String(last));
  } finally {
    jest.restoreAllMocks();
  }
  console.log(String(uses("abcb")));
});
