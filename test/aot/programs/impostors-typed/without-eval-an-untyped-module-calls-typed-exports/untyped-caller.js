import code, { halved, Scale, sum, total } from "./library.ts";

class Stack extends Array {
  get length() {
    return 1;
  }
}

export function untypedCalls(log) {
  return {
    "total of a string": () => total("12"),
    "total of an array-like": () => total({ length: 2, 0: 1, 1: "2" }),
    "total of a hole": () => total([1, , 3]),
    "total of strings": () => total(["1", "2"]),
    "total of bytes": () => total(new Uint8Array([1, 2])),
    "total of a subclass": () => total(Stack.from([1, 2, 3])),
    "total of a proxy": () => total(new Proxy([1, 2], {})),
    "total of null": () => total(null),
    "total of nothing": () => total(),
    "sum with a string": () => sum({ x: "1", y: 2 }),
    "sum with a getter": () => sum({ get x() { log.push("get-x"); return 1; }, y: 2 }),
    "sum in the other order": () => sum({ y: 2, x: 1 }),
    "sum of a short point": () => sum({ x: 1 }),
    "sum of a number": () => sum(5),
    "sum of null": () => sum(null),
    "code of an array": () => code(["a"]),
    "code of a number": () => code(65),
    "code of a String object": () => code(new String("ab")),
    "halved a string": () => halved("8"),
    "halved a bigint": () => halved(8n),
    "halved an object": () => halved({ valueOf() { log.push("valueOf"); return 8; } }),
    "halved nothing": () => halved(),
    "a scale made with a string": () => new Scale("3").apply(2),
    "a scale applied to a string": () => new Scale(3).apply("2"),
    "a scale's method on a literal": () => new Scale(3).apply.call({ factor: "f" }, 2),
    "a scale's method taken off": () => (0, new Scale(3).apply)(2),
    "a scale called without new": () => Scale(3),
    "a scale whose field was changed": () => { const s = new Scale(3); s.factor = "x"; return s.apply(2); },
    "a scale whose field was deleted": () => { const s = new Scale(3); delete s.factor; return s.apply(2); },
    "a subclass written in JavaScript": () => new (class extends Scale { apply(n) { return "js " + super.apply(n); } })(3).apply(2),
    "honest calls from JavaScript": () => [total([1, 2]), sum({ x: 1, y: 2 }), code("a"), halved(4), new Scale(2).apply(3)].join(),
  };
}
