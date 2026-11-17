import { test, expect, mock, spyOn } from "bun:test";
import { Keeper, hooks, real, byChoice, byCopy, byMethod, byCopiedMethod, inLoop, byParameter } from "./keeper.ts";
test("as written", async () => {
  for (let i = 0; i < 200; i++) await Promise.all([byChoice(i % 2 === 0, i), byCopy(i), byMethod(new Keeper(), i % 2 === 0, i), byCopiedMethod(new Keeper(), i), inLoop(new Keeper(), 3), byParameter(real, true, i)]);
  expect([await byChoice(true, 1), await byCopy(2), await byMethod(new Keeper(), true, 3), await byCopiedMethod(new Keeper(), 4), await inLoop(new Keeper(), 3), await byParameter(real, true, 5)]).toEqual(["string real 1", "string real 2", "string kept 31", "string kept 41", "string missed 0;string kept 11;string missed 2;", "string real 5"]);
});
test("a mock in the place of the function", async () => {
  const made = mock((x: unknown) => Promise.resolve("mocked " + x)); hooks.current = made;
  expect([await byChoice(true, 1), await byChoice(false, 1), await byCopy(2), await byParameter(made, true, 3)]).toEqual(["string mocked 1", "string missed 1", "string mocked 2", "string mocked 3"]);
  expect(made).toHaveBeenCalledTimes(3); hooks.current = real;
});
test("a spy on the method of one instance", async () => {
  const keeper = new Keeper(); const spy = spyOn(keeper, "fetchOne").mockImplementation((key: unknown) => Promise.resolve("spied " + key) as any);
  expect([await byMethod(keeper, true, 1), await byCopiedMethod(keeper, 2), await inLoop(keeper, 4)]).toEqual(["string spied 1", "string spied 2", "string missed 0;string spied 1;string missed 2;string spied 3;"]);
  expect(spy).toHaveBeenCalledTimes(4); spy.mockRestore(); expect(await byMethod(keeper, true, 5)).toBe("string kept 51");
});
test("a spy on the method of the class", async () => {
  const spy = spyOn(Keeper.prototype, "fetchOne").mockImplementation(function (key: unknown) { return Promise.resolve("of the class " + key) as any; });
  expect([await byMethod(new Keeper(), true, 1), await byCopiedMethod(new Keeper(), 2), await inLoop(new Keeper(), 2)]).toEqual(["string of the class 1", "string of the class 2", "string missed 0;string of the class 1;"]);
  spy.mockRestore(); expect(await byCopiedMethod(new Keeper(), 6)).toBe("string kept 61");
});
test("mocks that resolve, reject and give no promise", async () => {
  const made = mock(); hooks.current = made as any;
  made.mockResolvedValueOnce("resolved"); expect(await byChoice(true, 1)).toBe("string resolved");
  made.mockResolvedValueOnce("resolved again"); expect(await byCopy(1)).toBe("string resolved again");
  made.mockReturnValueOnce("no promise"); expect(await byChoice(true, 1)).toBe("string no promise");
  made.mockRejectedValueOnce(new Error("rejected")); expect(byChoice(true, 1)).rejects.toThrow("rejected");
  made.mockRejectedValueOnce(new Error("rejected too")); expect(byCopy(1)).rejects.toThrow("rejected too");
  made.mockReturnValueOnce({ then(ok: (x: unknown) => void) { ok("thenable"); } }); expect(await byCopy(1)).toBe("string thenable");
  hooks.current = real;
});
