import { type } from "arktype";

const User = type({
  name: "string",
  platform: "'android' | 'ios'",
  "versions?": "(number | string)[]",
  age: "number.integer >= 0",
  email: "string.email",
});
type User = typeof User.infer;
const out = User({ name: "Alan Turing", platform: "ios", versions: [1, "2"], age: 41, email: "alan@example.com" });
if (out instanceof type.errors) console.log(out.summary);
else {
  const user: User = out;
  console.log(JSON.stringify(user));
}
const bad = User({ name: 1, platform: "enigma", versions: [true], age: -1.5, email: "nope" });
console.log(bad instanceof type.errors, bad instanceof type.errors ? bad.summary : "");
console.log(
  type("string.numeric.parse")("5"),
  type("number[] | null").allows([1]),
  type({ a: "string" }).and({ b: "number" }).expression,
  JSON.stringify(type("1 | 2").toJsonSchema()),
);
