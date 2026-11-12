// Guards: a custom equality tester is handed the list that lies in a private field, and may change it. The compiler may prove nothing of what such a list holds.
import { expect, test } from "bun:test";
class Held { #list = [1, 2, 3]; sum() { let t = 0; for (let i = 0; i < this.#list.length; i++) t += this.#list[i]; return t; } }
expect.addEqualityTesters([(a, b) => { if (Array.isArray(a) && Array.isArray(b) && a.length === 3) { a.push("x"); b.push("x"); } return undefined; }]);
test("a tester is handed the list", () => { const held = new Held(); expect(held).toMatchObject(new Held()); console.log(String(held.sum())); });
