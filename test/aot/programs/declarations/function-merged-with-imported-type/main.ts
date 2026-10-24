// A local function whose name merges with an imported type: the value is the function.
import { type Node, type Token, other } from "./req/shapes.js"
function Node(this: { kind: number }, kind: number) { this.kind = kind }
function Token(this: { text: string }, text: string) { this.text = text }
const allocator = { node: () => Node as any, token: () => Token as any }
// `new` on these functions: type-rules/new-via-any-typed-this-function.
const n: Node = { kind: 0 }, t: Token = { text: "" }
allocator.node().call(n, 4)
allocator.token().call(t, "t")
console.log(n.kind, t.text, other, typeof Node, Node.name, n instanceof (Node as any))
