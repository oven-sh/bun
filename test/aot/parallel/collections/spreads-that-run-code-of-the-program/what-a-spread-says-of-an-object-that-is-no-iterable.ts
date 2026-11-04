// Every way in which an object of the program fails to be an iterable, spread where its type is known and where it is read out of an object under the global object. What is printed is what the error says.
// Plain Bun quotes the text of the program behind some of them, which compiled code does not hold.
const said = (error: unknown) => String(error).replace(/ \(evaluating .*\)$/, "");
const results: ((step: number) => unknown)[] = [() => undefined, () => null, () => 5, () => "text", () => true, () => Symbol.iterator, () => 10n];
const makers: (() => unknown)[] = [
  () => ({}),
  () => ({ [Symbol.iterator]: undefined }),
  () => ({ [Symbol.iterator]: null }),
  () => ({ [Symbol.iterator]: 5 }),
  () => ({ [Symbol.iterator]: {} }),
  () => ({ [Symbol.iterator]: "text" }),
  () => ({ [Symbol.iterator]() { return undefined; } }),
  () => ({ [Symbol.iterator]() { return null; } }),
  () => ({ [Symbol.iterator]() { return 5; } }),
  () => ({ [Symbol.iterator]() { return "text"; } }),
  () => ({ [Symbol.iterator]() { return {}; } }),
  () => ({ [Symbol.iterator]() { return { next: 5 }; } }),
  () => ({ [Symbol.iterator]() { return { next: null }; } }),
  () => ({ [Symbol.iterator]() { return { next: {} }; } }),
  () => ({ [Symbol.iterator]() { return { next: "text" }; } }),
  ...results.map(result => () => ({ [Symbol.iterator]() { return { next: result }; } })),
  () => ({ get [Symbol.iterator]() { throw new Error("the getter of the method"); } }),
  () => ({ [Symbol.iterator]() { throw new Error("the method"); } }),
  () => ({ [Symbol.iterator]() { return { get next() { throw new Error("the getter of next"); } }; } }),
  () => ({ [Symbol.iterator]() { return { next() { throw new Error("next"); } }; } }),
  () => ({ [Symbol.iterator]() { return { next() { return { get done() { throw new Error("the getter of done"); } }; } }; } }),
  () => ({ [Symbol.iterator]() { return { next() { return { done: false, get value() { throw new Error("the getter of value"); } }; } }; } }),
];
class Lacking {}
class Broken { [Symbol.iterator]() { return 5; } }
const count = (...values: unknown[]) => values.length;
(globalThis as any).held = {};
for (const make of [...makers, () => new Lacking(), () => new Broken()]) {
  const known: any = make();
  try { console.log([...known].length); } catch (error) { console.log(said(error)); }
  try { console.log(count(...known)); } catch (error) { console.log(said(error)); }
  (globalThis as any).held.it = make();
  try { console.log([...(globalThis as any).held.it].length); } catch (error) { console.log(said(error)); }
}
const lacking = new Lacking(), broken = new Broken();
try { console.log([...(lacking as any)].length); } catch (error) { console.log(said(error)); }
try { console.log([...(broken as any)].length); } catch (error) { console.log(said(error)); }
