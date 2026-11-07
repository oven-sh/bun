// Guards: a class of text that runs at run time lays its mark on an object of a compiled class as a property under a private symbol. Its value was that symbol itself, and toMatchObject() listed it and handed it to a custom equality tester.
import { expect, test } from "bun:test";
class Older { shown = 1; }
const Stamps = (0, eval)("(class extends (class { constructor(back) { return back; } }) { #method() {} #kept = 5; constructor(on) { super(on); } })");
const says = check => { try { check(); return "passes"; } catch (error) { return error.constructor.name; } };
test("what a tester is handed", () => {
  const seen = [];
  expect.addEqualityTesters([(a, b) => { seen.push(typeof a + ":" + typeof b); return undefined; }]);
  console.log(says(() => expect(new Stamps(new Older())).toMatchObject(new Stamps(new Older()))), seen.splice(0).join());
  console.log(says(() => expect(new Older()).toMatchObject(new Stamps(new Older()))), seen.splice(0).join());
});
