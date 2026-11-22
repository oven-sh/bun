// What a .proto file compiles to encodes, decodes and refuses as it does in plain Bun.
import { Kind, Shape } from "./shape.proto";

const bytes = Shape.encode({
  name: "é☃",
  kind: Kind.NEGATIVE,
  area: -0,
  id: BigInt("-9223372036854775808"),
  size: 2 ** 32 - 1,
  points: [{ x: -1, y: 2 }, {}],
  weights: [1.5, NaN],
  labels: { "-1": "a", 7: "b" },
  fill: { case: "inner", value: { raw: new Uint8Array([0, 255]) } },
  made: { seconds: 5, nanos: 6 },
});
console.log(bytes.toHex());
console.log(Shape.decode(bytes));

let total = 0;
for (let i = 0; i < 2000; i++) total += Shape.decode(Shape.encode({ size: i, points: [{ x: i }] })).points[0].x;
console.log(total);

for (const hex of ["0a05", "0a01ff", "00", "18ffffffffffffffffffff01"]) {
  try {
    Shape.decode(Uint8Array.fromHex(hex));
  } catch (error) {
    console.log(String(error));
  }
}
const shapes = [{ points: "ab" }, { points: [1] }, { weights: new Set() }, { labels: new Map() }, { made: "a" }];
for (const wrong of [{ size: -1 }, { name: 1 }, { id: 0.5 }, { fill: { case: "none" } }, ...shapes]) {
  try {
    Shape.encode(wrong as Shape.Init);
  } catch (error) {
    console.log(String(error));
  }
}
