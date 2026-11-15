import { test } from "bun:test";
const lookUp = (record: Record<string, { shade?: string }>, name: string) => record[name]?.shade;
function whileInheritedHas<T>(name: string, field: "shade" | "origin", read: () => T): T | string {
  const inherited: object = Reflect.get({}, name);
  try {
    if (!Reflect.defineProperty(inherited, field, { value: "off the prototype", configurable: true }))
      return "refused quietly";
  } catch (error) {
    return "refused: " + (error as Error).message.slice(0, 90);
  }
  try {
    return read();
  } finally {
    Reflect.deleteProperty(inherited, field);
  }
}
test("inherited", () => {
  for (const name of ["constructor", "toString", "__proto__"])
    console.log(
      "SAID by Reflect, the key typed as two texts:",
      name,
      whileInheritedHas(name, "shade", () => String(lookUp({}, name))),
    );
});
