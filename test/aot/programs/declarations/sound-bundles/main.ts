// Bundles: JavaScript as the bundler prints it, with the types of its sources put back.
import { watch } from "./augments";
import { Machine, depth, everything, leaf, mark, paint, pick, sum, type Tree } from "./constants";
import { Polite, serve, type Server } from "./greeter";
import * as spaces from "./namespaces";

(globalThis as any).injected = 4;

const server: Server = { port: 8080, options: { name: "world", loud: true } };
console.log("classes and interfaces:", serve(server, "a", "b"), new Polite("hi").greet({ name: "you" }, 2).join());

const tree: Tree = { kind: everything.Kind.Branch, left: leaf(1), right: leaf(2) };
console.log("inlined enum members:", sum(tree), depth(tree, 3), paint(), paint(everything.Color.Blue), new Machine().step(), new Machine().first);
const marked = mark({}, "n");
console.log("unique symbols:", marked.name, Object.getOwnPropertySymbols(marked).length, String(pick("KEY")), String(pick("OTHER")));
console.log("constants:", pick("NAME"), pick("COUNT"), pick("NIL"), pick("NOTHING"), everything.used());
console.log("a namespace object:", Object.keys(everything).join(), typeof everything.Unused);
console.log("enum objects:", JSON.stringify(everything.Kind), JSON.stringify(everything.Color));

const made = spaces.box(4);
console.log("another bundle:", made.get(), String(spaces.pick("NAME")), spaces.names().join(), spaces.everything.used());
console.log("its class through the namespace object:", new spaces.everything.Box("x").get(), spaces.everything.Color.Blue, Object.getOwnPropertySymbols(made).length);
console.log("a global that is augmented:", Object.keys(watch(1)).length, Object.getOwnPropertySymbols(watch(1)).length);
