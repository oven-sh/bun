// Guards: two lists match as a whole, and a key that one of them lacks stands for undefined there. A private field is no such key: both lists need it. Plain Bun took a private field that holds undefined for a key that the other list may lack and passed the pair, and an executable, which counts private fields, failed it.
import { expect, test } from "bun:test";
class Bare extends Array {}
class Unset extends Array { #kept; }
class Other extends Array { #other; }
class Two extends Array { #first; #second; }
class Held extends Array { #kept; static of(kept, ...items) { const list = super.of(...items); list.#kept = kept; return list; } }
const says = check => { try { return check() === false ? "false" : "passes"; } catch (error) { return error.constructor.name; } };
const holed = list => { delete list[0]; return list; };
test("one list alone has the field", () => {
  console.log(says(() => expect(Unset.of(1)).toMatchObject([1])), says(() => expect([1]).toMatchObject(Unset.of(1))), says(() => expect(Unset.of(1)).toMatchObject(Bare.of(1))), says(() => expect(Unset.of(1)).toMatchObject(Other.of(1))), says(() => expect(Two.of(1)).toMatchObject(Unset.of(1))), says(() => expect(Unset.of(1)).toMatchObject(Two.of(1))));
  console.log(says(() => expect(holed(Unset.of(0, 1))).toMatchObject([undefined, 1])), says(() => expect([undefined, 1]).toMatchObject(holed(Unset.of(0, 1)))), says(() => expect(holed(Unset.of(0, 1))).toMatchObject(Other.of(undefined, 1))));
  console.log(says(() => Bun.deepMatch([1], Unset.of(1))), says(() => Bun.deepMatch(Unset.of(1), [1])), says(() => Bun.deepMatch(Unset.of(1), Other.of(1))), says(() => Bun.deepMatch([undefined, 1], holed(Unset.of(0, 1)))));
});
test("both lists have the field", () => {
  console.log(says(() => expect(Held.of(1, 1)).toMatchObject(Held.of(1, 1))), says(() => expect(Held.of(2, 1)).toMatchObject(Held.of(1, 1))), says(() => expect(Held.of(1, 1)).toMatchObject(Held.of(expect.any(Number), 1))));
  console.log(says(() => expect(holed(Held.of(1, 0, 1))).toMatchObject(Held.of(1, undefined, 1))), says(() => expect(Held.of(1, undefined, 1)).toMatchObject(holed(Held.of(1, 0, 1)))), says(() => expect(holed(Held.of(2, 0, 1))).toMatchObject(Held.of(1, undefined, 1))));
  console.log(says(() => Bun.deepMatch(Held.of(1, undefined, 1), holed(Held.of(1, 0, 1)))), says(() => Bun.deepMatch(Held.of(2, undefined, 1), holed(Held.of(1, 0, 1)))));
});
test("objectContaining", () => {
  console.log(says(() => expect(Unset.of(1)).toEqual(expect.objectContaining([1]))), says(() => expect(Unset.of(1)).toEqual(expect.objectContaining(Unset.of(1)))), says(() => expect(Unset.of(1)).toEqual(expect.objectContaining(Other.of(1)))), says(() => expect(holed(Unset.of(0, 1))).toEqual(expect.objectContaining(Unset.of(undefined, 1)))));
});
