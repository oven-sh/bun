// Guards: toMatchObject() and expect.objectContaining() compare private fields too. An object of a compiled class shows native code no private name, so a test that must fail passed.
import { expect, test } from "bun:test";
class Held { shown = 1; #kept; constructor(kept) { this.#kept = kept; } }
const says = check => { try { check(); return "passes"; } catch (error) { return error.constructor.name; } };
test("toMatchObject", () => {
  console.log(says(() => expect(new Held(2)).toMatchObject(new Held(1))), says(() => expect(new Held(1)).toMatchObject(new Held(1))), says(() => expect(new Held(2)).not.toMatchObject(new Held(1))), says(() => expect(new Held({ a: 1, b: 2 })).toMatchObject(new Held({ a: 1 }))), says(() => expect(new Held({ a: 1 })).toMatchObject(new Held({ a: 2 }))));
});
test("objectContaining", () => {
  console.log(says(() => expect(new Held(2)).toEqual(expect.objectContaining(new Held(1)))), says(() => expect(new Held(1)).toEqual(expect.objectContaining(new Held(1)))), says(() => expect({ in: new Held(2) }).toMatchObject({ in: expect.objectContaining(new Held(1)) })), says(() => expect(new Held(expect.any(Number))).not.toMatchObject(new Held(1))), says(() => expect(new Held(1)).toMatchObject(new Held(expect.any(Number)))));
});
