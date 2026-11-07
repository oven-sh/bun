// Guards: a custom equality tester is handed values of the language alone. On an older object the mark of a compiled class is a property under a private symbol whose value is a cell of the engine: toMatchObject() listed it and handed it to the tester.
import { expect, test } from "bun:test";
class Hands { constructor(back) { return back; } }
const make = () => class extends Hands { #kept; constructor(on, kept) { super(on); this.#kept = kept; } };
const [First, Second] = [make(), make()];
class Once extends Hands { #method() {} constructor(on) { super(on); } }
const lay = (Class, kept) => { const older = { shown: 1 }; new Class(older, kept); return older; };
const says = check => { try { check(); return "passes"; } catch (error) { return error.constructor.name; } };
test("what a tester is handed", () => {
  const seen = [];
  expect.addEqualityTesters([(a, b) => { seen.push(typeof a + ":" + typeof b); return undefined; }]);
  console.log(says(() => expect(lay(First, 1)).toMatchObject(lay(First, 1))), seen.splice(0).join());
  console.log(says(() => expect(lay(First, 1)).toMatchObject(lay(Second, 1))), seen.splice(0).join());
  console.log(says(() => expect(lay(Once)).toMatchObject(lay(Once))), seen.splice(0).join());
});
