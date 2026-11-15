import { test } from "bun:test";
import { whileAboveHas } from "./helper";
class Kept {
  origin = "own";
}
const look = (value: any) => [value.shade, value.origin];
test("t", () => {
  for (const name of JSON.parse('["__proto__","toString"]'))
    for (const field of ["shade", "origin"] as const)
      console.log(
        "SAID",
        name,
        field,
        whileAboveHas(name, field, () => [look({}), look(new Kept()), look([]), look(() => 1)]),
        look({}),
      );
});
