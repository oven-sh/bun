// Guards: expect.objectContaining() takes the keys that its sample owns, so it asks for no private field that the sample only inherits. A sample that owns a private field is matched through its prototypes, as toMatchObject() matches every pattern. A compiled run matches the private fields of the whole chain of a pattern or of none of it.
import { expect, test } from "bun:test";
class Held { #kept; constructor(kept) { this.#kept = kept; } }
class Other { #other; constructor(other) { this.#other = other; } }
const says = check => { try { check(); return "passes"; } catch (error) { return error.constructor.name; } };
const over = (object, above) => Object.setPrototypeOf(object, above);
test("a sample that only inherits a private field", () => {
  const sample = () => Object.create(new Held(1));
  console.log(says(() => expect({}).toEqual(expect.objectContaining(sample()))), says(() => expect(Object.create(new Held(2))).toEqual(expect.objectContaining(sample()))), says(() => expect({}).toEqual(expect.not.objectContaining(sample()))), says(() => expect({ in: {} }).toMatchObject({ in: expect.objectContaining(sample()) })), says(() => expect({}).toMatchObject(sample())));
});
test("a sample that owns a private field and inherits another", () => {
  const sample = () => over(new Held(1), new Other(1));
  console.log(says(() => expect(over(new Held(1), new Other(1))).toEqual(expect.objectContaining(sample()))), says(() => expect(over(new Held(1), new Other(2))).toEqual(expect.objectContaining(sample()))), says(() => expect(over(new Held(2), new Other(1))).toEqual(expect.objectContaining(sample()))), says(() => expect(new Held(1)).toEqual(expect.objectContaining(sample()))), says(() => expect({}).toEqual(expect.not.objectContaining(sample()))));
});
