import { type Static, Type } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { Value } from "@sinclair/typebox/value";

const T = Type.Object({
  x: Type.Number(),
  y: Type.Optional(Type.String({ minLength: 2 })),
  z: Type.Union([Type.Literal("a"), Type.Literal("b")]),
  list: Type.Array(Type.Integer(), { maxItems: 2 }),
});
type T = Static<typeof T>;
const value: T = { x: 1, z: "a", list: [1] };
console.log(JSON.stringify(T), Value.Check(T, value), Value.Check(T, { x: "1", z: "c", list: [1.5, 2, 3] }));
console.log(
  [...Value.Errors(T, { x: "1", y: "a", z: "c", list: [1.5, 2, 3] })]
    .map(error => `${error.path}: ${error.message}`)
    .join("; "),
);
const C = TypeCompiler.Compile(T);
console.log(
  C.Check(value),
  C.Check({}),
  C.Code().length > 100,
  JSON.stringify(Value.Create(T)),
  JSON.stringify(Value.Convert(T, { x: "1", z: "a", list: ["2"] })),
  JSON.stringify(Value.Clean(T, { ...value, more: 1 })),
);
