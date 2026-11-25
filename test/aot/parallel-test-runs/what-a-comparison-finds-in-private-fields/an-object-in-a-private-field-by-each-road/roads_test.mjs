// Guards: an object in a private field is handed to a comparison only where the build has followed an object of the class to it. A test imports expect(), so no proof says what it calls: the build goes by the binding. Each class here comes to a comparison by one road alone.
import { expect, mock, test } from "bun:test";
import * as runner from "bun:test";
class ByEqual { #kept; constructor(kept) { this.#kept = kept; } }
class ByMatch { #kept; constructor(kept) { this.#kept = kept; } }
class ByNot { #kept; constructor(kept) { this.#kept = kept; } }
class ByPattern { #kept; constructor(kept) { this.#kept = kept; } }
class ByContaining { #kept; constructor(kept) { this.#kept = kept; } }
class ByMock { #kept; constructor(kept) { this.#kept = kept; } }
class ByHelper { #kept; constructor(kept) { this.#kept = kept; } }
class ByNamespace { #kept; constructor(kept) { this.#kept = kept; } }
const says = check => { try { check(); return "passes"; } catch (error) { return String(error.message).startsWith("Cannot compare") ? "refused" : "fails"; } };
const check = (value, pattern) => expect(value).toMatchObject(pattern);
const outOfSight = value => JSON.parse("[0]").map(() => value)[0];
test("an object in a private field", () => {
  console.log("toEqual", says(() => expect(new ByEqual({ a: 1 })).toEqual(new ByEqual({ a: 2 }))));
  console.log("toMatchObject", says(() => expect(new ByMatch({ a: 1, b: 2 })).toMatchObject(new ByMatch({ a: 1 }))), says(() => expect(new ByMatch({ a: 1 })).toMatchObject(new ByMatch({ a: 2 }))));
  console.log("not", says(() => expect(new ByNot({ a: 1 })).not.toMatchObject(new ByNot({ a: 2 }))), says(() => expect(new ByNot({ a: 1 })).not.toMatchObject(new ByNot({ a: 1 }))));
  console.log("the pattern alone is in sight", says(() => expect(outOfSight(new ByPattern({ a: 1 }))).toMatchObject(new ByPattern({ a: 1 }))));
  console.log("objectContaining", says(() => expect(new ByContaining({ a: 1 })).toEqual(expect.objectContaining(new ByContaining({ a: 1 })))), says(() => expect(new ByContaining({ a: 1 })).toEqual(expect.objectContaining(new ByContaining({ a: 2 })))));
  const called = mock();
  called(new ByMock({ a: 1 }));
  console.log("a mock", says(() => expect(called).toHaveBeenCalledWith(expect.objectContaining(new ByMock({ a: 1 })))), says(() => expect(called).toHaveBeenCalledWith(expect.objectContaining(new ByMock({ a: 2 })))));
  console.log("a helper", says(() => check(new ByHelper({ a: 1 }), new ByHelper({ a: 1 }))), says(() => check(new ByHelper({ a: 1 }), new ByHelper({ a: 2 }))));
  console.log("a namespace", says(() => runner.expect(new ByNamespace({ a: 1 })).toMatchObject(new ByNamespace({ a: 1 }))), says(() => runner.expect(new ByNamespace({ a: 1 })).toMatchObject(new ByNamespace({ a: 2 }))));
});
