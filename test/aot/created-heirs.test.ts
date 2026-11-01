// `Object.create(above)` at two places of one function: flow gives an object that stands above others one class, so what the two places make is of one layout.
// With a layout a place, neither had a class and every member was looked for by name.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "node:path";
import { slot } from "./harness/commands";
import { buildCounted, countScript } from "./harness/counted-run";
import { compileCommand } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const rounds = `
  const above = { get one() { return this.b + 1; }, two() { return this.b + 2; } };
  const first = Object.create(above), second = Object.create(above);
  first.b = 1;
  second.b = 2;
  const units = Number(process.argv[2]);
  let sum = 0;
  for (let unit = 0; unit < units; unit++) {
    const heir = unit & 1 ? second : first;
    sum += heir.one + heir.two();
  }
  console.log(sum > 0 ? "ok" : "no");
`;

test(
  "a getter and a method are found through heirs made at two places without a look by name",
  () =>
    slot(async () => {
      using dir = tempDir("aot-created-heirs", { "rounds.js": rounds });
      const folder = String(dir);
      const work = await countScript(await buildCounted(folder, "./rounds.js"), folder, "ok\n", {
        warmUp: 2,
        units: 10,
      });
      expect(work.accessesByName).toBe(0);
    }),
  300_000,
);

const programs = {
  "shapes.cjs": `const target = { get one() { return this.b + 1; }, two() { return this.b + 2; }, kind: 7, b: 3 };
const a = Object.create(target), c = Object.create(target), bare = Object.create(target);
a.x = 1; a.y = 2; a.b = 10;
c.z = 3; c.b = 20; c.x = 4;
const listed = object => { const names = []; for (const name in object) names.push(name); return names.join(); };
for (const heir of [a, c, bare]) {
  console.log(Object.keys(heir).join(), "|", listed(heir), "|", JSON.stringify(heir), "|", heir.one, heir.two(), heir.kind);
  console.log(["x", "y", "z", "b", "one", "kind"].map(name => \`\${name}:\${Object.hasOwn(heir, name)}:\${name in heir}\`).join(" "));
  console.log(Object.getPrototypeOf(heir) === target, Reflect.ownKeys(heir).length, heir.y, heir.z, heir.missing);
}
delete a.x; a.x = 5; delete c.b;
console.log(Object.keys(a).join(), a.one, Object.keys(c).join(), c.one, c.b);
console.log(Object.entries({ ...a, ...c }).join(";"), Object.isExtensible(a), Object.isFrozen(Object.freeze(c)), class { static store() { try { c.q = 1; return "stored"; } catch (error) { return error.constructor.name; } } }.store());
`,
  "many-above.cjs": `function pair(above, b) {
  const first = Object.create(above), second = Object.create(above);
  first.b = b; second.b = b * 2; second.extra = "e";
  return [first, second];
}
const cat = { get one() { return "cat" + this.b; }, say() { return "meow" + this.b; } };
const dog = { get one() { return "dog" + this.b; }, say() { return "woof" + this.b; }, legs: 4 };
const none = null;
const all = [...pair(cat, 1), ...pair(dog, 2), ...pair(cat, 3), ...pair(Object.create(dog), 4)];
let text = "";
for (let i = 0; i < 4000; i++) { const heir = all[i & 7]; if (i > 3990) text += heir.one + heir.say() + (heir.legs ?? "-") + " "; else heir.one, heir.say(); }
console.log(text);
const [orphan, other] = pair(none, 5);
console.log(Object.getPrototypeOf(orphan), orphan.b, other.extra, orphan.one, "toString" in orphan, Object.keys(other).join());
for (const bad of [1, "s", undefined, true, Symbol.iterator]) { try { pair(bad, 1); console.log("made"); } catch (error) { console.log(error.constructor.name, error.message); } }
console.log(all.map(heir => [cat, dog].indexOf(Object.getPrototypeOf(heir))).join(), cat.isPrototypeOf(all[0]), dog.isPrototypeOf(all[7]), dog.isPrototypeOf(all[0]));
`,
  "changes-at-top.cjs": `process.on("change", above => { above.two = () => 77; });
const t0 = { get one() { return this.b + 1; }, two() { return this.b + 2; }, kind: 7 };
const a0 = Object.create(t0), c0 = Object.create(t0);
a0.b = 1; c0.b = 2;
{
  let before = 0, after = 0, threw = "";
  for (let i = 0; i < 300; i++) { const heir = i & 1 ? c0 : a0; before += heir.one + heir.two() + heir.kind; }
  try {  } catch (error) { threw = " threw " + error.constructor.name; }
  try { for (let i = 0; i < 300; i++) { const heir = i & 1 ? c0 : a0; after += heir.one + heir.two() + heir.kind; } } catch (error) { after = "threw " + error.constructor.name; }
  console.log("nothing: " + before + " > " + after + threw);
}
const t1 = { get one() { return this.b + 1; }, two() { return this.b + 2; }, kind: 7 };
const a1 = Object.create(t1), c1 = Object.create(t1);
a1.b = 1; c1.b = 2;
{
  let before = 0, after = 0, threw = "";
  for (let i = 0; i < 300; i++) { const heir = i & 1 ? c1 : a1; before += heir.one + heir.two() + heir.kind; }
  try { Object.defineProperty(t1, "one", { get() { return 100; }, configurable: true }); } catch (error) { threw = " threw " + error.constructor.name; }
  try { for (let i = 0; i < 300; i++) { const heir = i & 1 ? c1 : a1; after += heir.one + heir.two() + heir.kind; } } catch (error) { after = "threw " + error.constructor.name; }
  console.log("getter redefined: " + before + " > " + after + threw);
}
const t2 = { get one() { return this.b + 1; }, two() { return this.b + 2; }, kind: 7 };
const a2 = Object.create(t2), c2 = Object.create(t2);
a2.b = 1; c2.b = 2;
{
  let before = 0, after = 0, threw = "";
  for (let i = 0; i < 300; i++) { const heir = i & 1 ? c2 : a2; before += heir.one + heir.two() + heir.kind; }
  try { Object.defineProperty(t2, "one", { value: 5, configurable: true }); } catch (error) { threw = " threw " + error.constructor.name; }
  try { for (let i = 0; i < 300; i++) { const heir = i & 1 ? c2 : a2; after += heir.one + heir.two() + heir.kind; } } catch (error) { after = "threw " + error.constructor.name; }
  console.log("getter becomes a value: " + before + " > " + after + threw);
}
const t3 = { get one() { return this.b + 1; }, two() { return this.b + 2; }, kind: 7 };
const a3 = Object.create(t3), c3 = Object.create(t3);
a3.b = 1; c3.b = 2;
{
  let before = 0, after = 0, threw = "";
  for (let i = 0; i < 300; i++) { const heir = i & 1 ? c3 : a3; before += heir.one + heir.two() + heir.kind; }
  try { delete t3.one; } catch (error) { threw = " threw " + error.constructor.name; }
  try { for (let i = 0; i < 300; i++) { const heir = i & 1 ? c3 : a3; after += heir.one + heir.two() + heir.kind; } } catch (error) { after = "threw " + error.constructor.name; }
  console.log("getter deleted: " + before + " > " + after + threw);
}
const t4 = { get one() { return this.b + 1; }, two() { return this.b + 2; }, kind: 7 };
const a4 = Object.create(t4), c4 = Object.create(t4);
a4.b = 1; c4.b = 2;
{
  let before = 0, after = 0, threw = "";
  for (let i = 0; i < 300; i++) { const heir = i & 1 ? c4 : a4; before += heir.one + heir.two() + heir.kind; }
  try { t4.two = () => 1000; } catch (error) { threw = " threw " + error.constructor.name; }
  try { for (let i = 0; i < 300; i++) { const heir = i & 1 ? c4 : a4; after += heir.one + heir.two() + heir.kind; } } catch (error) { after = "threw " + error.constructor.name; }
  console.log("method replaced: " + before + " > " + after + threw);
}
const t5 = { get one() { return this.b + 1; }, two() { return this.b + 2; }, kind: 7 };
const a5 = Object.create(t5), c5 = Object.create(t5);
a5.b = 1; c5.b = 2;
{
  let before = 0, after = 0, threw = "";
  for (let i = 0; i < 300; i++) { const heir = i & 1 ? c5 : a5; before += heir.one + heir.two() + heir.kind; }
  try { delete t5.two; } catch (error) { threw = " threw " + error.constructor.name; }
  try { for (let i = 0; i < 300; i++) { const heir = i & 1 ? c5 : a5; after += heir.one + heir.two() + heir.kind; } } catch (error) { after = "threw " + error.constructor.name; }
  console.log("method deleted: " + before + " > " + after + threw);
}
const t6 = { get one() { return this.b + 1; }, two() { return this.b + 2; }, kind: 7 };
const a6 = Object.create(t6), c6 = Object.create(t6);
a6.b = 1; c6.b = 2;
{
  let before = 0, after = 0, threw = "";
  for (let i = 0; i < 300; i++) { const heir = i & 1 ? c6 : a6; before += heir.one + heir.two() + heir.kind; }
  try { t6.kind = 70; } catch (error) { threw = " threw " + error.constructor.name; }
  try { for (let i = 0; i < 300; i++) { const heir = i & 1 ? c6 : a6; after += heir.one + heir.two() + heir.kind; } } catch (error) { after = "threw " + error.constructor.name; }
  console.log("value replaced: " + before + " > " + after + threw);
}
const t7 = { get one() { return this.b + 1; }, two() { return this.b + 2; }, kind: 7 };
const a7 = Object.create(t7), c7 = Object.create(t7);
a7.b = 1; c7.b = 2;
{
  let before = 0, after = 0, threw = "";
  for (let i = 0; i < 300; i++) { const heir = i & 1 ? c7 : a7; before += heir.one + heir.two() + heir.kind; }
  try { Object.defineProperty(a7, "one", { get() { return -1; } }); } catch (error) { threw = " threw " + error.constructor.name; }
  try { for (let i = 0; i < 300; i++) { const heir = i & 1 ? c7 : a7; after += heir.one + heir.two() + heir.kind; } } catch (error) { after = "threw " + error.constructor.name; }
  console.log("own getter on one heir: " + before + " > " + after + threw);
}
const t8 = { get one() { return this.b + 1; }, two() { return this.b + 2; }, kind: 7 };
const a8 = Object.create(t8), c8 = Object.create(t8);
a8.b = 1; c8.b = 2;
{
  let before = 0, after = 0, threw = "";
  for (let i = 0; i < 300; i++) { const heir = i & 1 ? c8 : a8; before += heir.one + heir.two() + heir.kind; }
  try { c8.two = () => -2; } catch (error) { threw = " threw " + error.constructor.name; }
  try { for (let i = 0; i < 300; i++) { const heir = i & 1 ? c8 : a8; after += heir.one + heir.two() + heir.kind; } } catch (error) { after = "threw " + error.constructor.name; }
  console.log("own method on the other: " + before + " > " + after + threw);
}
const t9 = { get one() { return this.b + 1; }, two() { return this.b + 2; }, kind: 7 };
const a9 = Object.create(t9), c9 = Object.create(t9);
a9.b = 1; c9.b = 2;
{
  let before = 0, after = 0, threw = "";
  for (let i = 0; i < 300; i++) { const heir = i & 1 ? c9 : a9; before += heir.one + heir.two() + heir.kind; }
  try { a9.kind = 0; } catch (error) { threw = " threw " + error.constructor.name; }
  try { for (let i = 0; i < 300; i++) { const heir = i & 1 ? c9 : a9; after += heir.one + heir.two() + heir.kind; } } catch (error) { after = "threw " + error.constructor.name; }
  console.log("own value on one heir: " + before + " > " + after + threw);
}
const t10 = { get one() { return this.b + 1; }, two() { return this.b + 2; }, kind: 7 };
const a10 = Object.create(t10), c10 = Object.create(t10);
a10.b = 1; c10.b = 2;
{
  let before = 0, after = 0, threw = "";
  for (let i = 0; i < 300; i++) { const heir = i & 1 ? c10 : a10; before += heir.one + heir.two() + heir.kind; }
  try { Object.setPrototypeOf(a10, { one: 1, two() { return 1; }, kind: 1 }); } catch (error) { threw = " threw " + error.constructor.name; }
  try { for (let i = 0; i < 300; i++) { const heir = i & 1 ? c10 : a10; after += heir.one + heir.two() + heir.kind; } } catch (error) { after = "threw " + error.constructor.name; }
  console.log("one heir gets another prototype: " + before + " > " + after + threw);
}
const t11 = { get one() { return this.b + 1; }, two() { return this.b + 2; }, kind: 7 };
const a11 = Object.create(t11), c11 = Object.create(t11);
a11.b = 1; c11.b = 2;
{
  let before = 0, after = 0, threw = "";
  for (let i = 0; i < 300; i++) { const heir = i & 1 ? c11 : a11; before += heir.one + heir.two() + heir.kind; }
  try { Object.setPrototypeOf(c11, null); } catch (error) { threw = " threw " + error.constructor.name; }
  try { for (let i = 0; i < 300; i++) { const heir = i & 1 ? c11 : a11; after += heir.one + heir.two() + heir.kind; } } catch (error) { after = "threw " + error.constructor.name; }
  console.log("the other gets null: " + before + " > " + after + threw);
}
const t12 = { get one() { return this.b + 1; }, two() { return this.b + 2; }, kind: 7 };
const a12 = Object.create(t12), c12 = Object.create(t12);
a12.b = 1; c12.b = 2;
{
  let before = 0, after = 0, threw = "";
  for (let i = 0; i < 300; i++) { const heir = i & 1 ? c12 : a12; before += heir.one + heir.two() + heir.kind; }
  try { Object.setPrototypeOf(t12, { kind: 9, more: 1 }); } catch (error) { threw = " threw " + error.constructor.name; }
  try { for (let i = 0; i < 300; i++) { const heir = i & 1 ? c12 : a12; after += heir.one + heir.two() + heir.kind; } } catch (error) { after = "threw " + error.constructor.name; }
  console.log("the object above gets another prototype: " + before + " > " + after + threw);
}
const t13 = { get one() { return this.b + 1; }, two() { return this.b + 2; }, kind: 7 };
const a13 = Object.create(t13), c13 = Object.create(t13);
a13.b = 1; c13.b = 2;
{
  let before = 0, after = 0, threw = "";
  for (let i = 0; i < 300; i++) { const heir = i & 1 ? c13 : a13; before += heir.one + heir.two() + heir.kind; }
  try { a13.__proto__ = { one: 2, two() { return 2; }, kind: 2 }; } catch (error) { threw = " threw " + error.constructor.name; }
  try { for (let i = 0; i < 300; i++) { const heir = i & 1 ? c13 : a13; after += heir.one + heir.two() + heir.kind; } } catch (error) { after = "threw " + error.constructor.name; }
  console.log("__proto__ stored: " + before + " > " + after + threw);
}
const t14 = { get one() { return this.b + 1; }, two() { return this.b + 2; }, kind: 7 };
const a14 = Object.create(t14), c14 = Object.create(t14);
a14.b = 1; c14.b = 2;
{
  let before = 0, after = 0, threw = "";
  for (let i = 0; i < 300; i++) { const heir = i & 1 ? c14 : a14; before += heir.one + heir.two() + heir.kind; }
  try { Object.assign(t14, { two() { return 3; }, kind: 3 }); } catch (error) { threw = " threw " + error.constructor.name; }
  try { for (let i = 0; i < 300; i++) { const heir = i & 1 ? c14 : a14; after += heir.one + heir.two() + heir.kind; } } catch (error) { after = "threw " + error.constructor.name; }
  console.log("assign over all: " + before + " > " + after + threw);
}
const t15 = { get one() { return this.b + 1; }, two() { return this.b + 2; }, kind: 7 };
const a15 = Object.create(t15), c15 = Object.create(t15);
a15.b = 1; c15.b = 2;
{
  let before = 0, after = 0, threw = "";
  for (let i = 0; i < 300; i++) { const heir = i & 1 ? c15 : a15; before += heir.one + heir.two() + heir.kind; }
  try { Object.freeze(t15); } catch (error) { threw = " threw " + error.constructor.name; }
  try { for (let i = 0; i < 300; i++) { const heir = i & 1 ? c15 : a15; after += heir.one + heir.two() + heir.kind; } } catch (error) { after = "threw " + error.constructor.name; }
  console.log("frozen above: " + before + " > " + after + threw);
}
const t16 = { get one() { return this.b + 1; }, two() { return this.b + 2; }, kind: 7 };
const a16 = Object.create(t16), c16 = Object.create(t16);
a16.b = 1; c16.b = 2;
{
  let before = 0, after = 0, threw = "";
  for (let i = 0; i < 300; i++) { const heir = i & 1 ? c16 : a16; before += heir.one + heir.two() + heir.kind; }
  try { delete a16.b; } catch (error) { threw = " threw " + error.constructor.name; }
  try { for (let i = 0; i < 300; i++) { const heir = i & 1 ? c16 : a16; after += heir.one + heir.two() + heir.kind; } } catch (error) { after = "threw " + error.constructor.name; }
  console.log("field deleted from an heir: " + before + " > " + after + threw);
}
const t17 = { get one() { return this.b + 1; }, two() { return this.b + 2; }, kind: 7 };
const a17 = Object.create(t17), c17 = Object.create(t17);
a17.b = 1; c17.b = 2;
{
  let before = 0, after = 0, threw = "";
  for (let i = 0; i < 300; i++) { const heir = i & 1 ? c17 : a17; before += heir.one + heir.two() + heir.kind; }
  try { Object.defineProperty(a17, "b", { get() { return 50; } }); } catch (error) { threw = " threw " + error.constructor.name; }
  try { for (let i = 0; i < 300; i++) { const heir = i & 1 ? c17 : a17; after += heir.one + heir.two() + heir.kind; } } catch (error) { after = "threw " + error.constructor.name; }
  console.log("field becomes a getter: " + before + " > " + after + threw);
}
const t18 = { get one() { return this.b + 1; }, two() { return this.b + 2; }, kind: 7 };
const a18 = Object.create(t18), c18 = Object.create(t18);
a18.b = 1; c18.b = 2;
{
  let before = 0, after = 0, threw = "";
  for (let i = 0; i < 300; i++) { const heir = i & 1 ? c18 : a18; before += heir.one + heir.two() + heir.kind; }
  try { Reflect.set(t18, "kind", 11, a18); } catch (error) { threw = " threw " + error.constructor.name; }
  try { for (let i = 0; i < 300; i++) { const heir = i & 1 ? c18 : a18; after += heir.one + heir.two() + heir.kind; } } catch (error) { after = "threw " + error.constructor.name; }
  console.log("Reflect.set through an heir: " + before + " > " + after + threw);
}
const t19 = { get one() { return this.b + 1; }, two() { return this.b + 2; }, kind: 7 };
const a19 = Object.create(t19), c19 = Object.create(t19);
a19.b = 1; c19.b = 2;
{
  let before = 0, after = 0, threw = "";
  for (let i = 0; i < 300; i++) { const heir = i & 1 ? c19 : a19; before += heir.one + heir.two() + heir.kind; }
  try { t19[["o", "ne"].join("")] = 4; } catch (error) { threw = " threw " + error.constructor.name; }
  try { for (let i = 0; i < 300; i++) { const heir = i & 1 ? c19 : a19; after += heir.one + heir.two() + heir.kind; } } catch (error) { after = "threw " + error.constructor.name; }
  console.log("key nobody spells: " + before + " > " + after + threw);
}
const t20 = { get one() { return this.b + 1; }, two() { return this.b + 2; }, kind: 7 };
const a20 = Object.create(t20), c20 = Object.create(t20);
a20.b = 1; c20.b = 2;
{
  let before = 0, after = 0, threw = "";
  for (let i = 0; i < 300; i++) { const heir = i & 1 ? c20 : a20; before += heir.one + heir.two() + heir.kind; }
  try { process.emit("change", t20); } catch (error) { threw = " threw " + error.constructor.name; }
  try { for (let i = 0; i < 300; i++) { const heir = i & 1 ? c20 : a20; after += heir.one + heir.two() + heir.kind; } } catch (error) { after = "threw " + error.constructor.name; }
  console.log("changed by whoever listens: " + before + " > " + after + threw);
}
`,
};

test.each(Object.keys(programs))(
  "%s answers as under plain Bun",
  name =>
    slot(async () => {
      using dir = tempDir("aot-created-heirs", programs);
      const folder = String(dir);
      const executable = join(folder, "compiled");
      const built = await run([bunExe(), ...compileCommand, name, "--outfile", executable], folder, bunEnv);
      expect({ exitCode: built.exitCode, said: built.exitCode ? built.stdout + built.stderr : "" }).toEqual({
        exitCode: 0,
        said: "",
      });
      const plain = await run([bunExe(), name], folder, bunEnv);
      expect(plain.stdout.split("\n").length).toBeGreaterThan(8);
      expect(await run([executable], folder, bunEnv)).toEqual(plain);
    }),
  300_000,
);
