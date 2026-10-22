// The origin of an object type is the symbol that declares it: an interface, or an alias declared at the top level of a file or a namespace. Any other type literal is its own origin.
interface Point { x: number }
type Pair = { a: number; b: number };
function local() {
  type Inner = { c: number };
  let v4: Inner;
}
let v1: Point;
let v2: Pair;
let v3: { d: number };
export {};
