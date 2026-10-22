// Object.defineProperty on a declared property works as in plain Bun where the property stays a writable, enumerable, configurable data property.
interface Point { x: number; y?: number }
class Pair { x: number = 1; y?: number }
const makers: [string, () => any][] = [
  ["a class instance", () => new Pair()],
  ["a literal", () => { const point: Point = { x: 1 }; return point; }],
];
const show = (o: object, name: string) => JSON.stringify(Object.getOwnPropertyDescriptor(o, name));
for (const [how, make] of makers) {
  const o = make();
  Object.defineProperty(o, "x", { value: 5 });
  console.log(how + ", a value alone:", show(o, "x"));
  Object.defineProperty(o, "x", { value: 6, writable: true, enumerable: true, configurable: true });
  console.log("  everything spelled out:", show(o, "x"));
  Object.defineProperty(o, "x", { writable: true });
  Object.defineProperty(o, "x", { enumerable: true, configurable: true });
  Object.defineProperty(o, "x", {});
  console.log("  what it has already:", show(o, "x"));
  console.log("  Reflect:", Reflect.defineProperty(o, "x", { value: 7 }), o.x);
  delete o.y;
  Object.defineProperty(o, "y", { value: 2, writable: true, enumerable: true, configurable: true });
  console.log("  an absent optional property:", show(o, "y"), Object.keys(o).join());
  Object.defineProperties(o, { x: { value: 8 }, y: { value: 9 } });
  console.log("  both:", JSON.stringify(o));
}
