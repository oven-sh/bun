// Methods, getters and functions under well-known symbols, in literals and in classes: the property `name` and its attributes, what the console calls them, what the frames of a getter, a generator and an async method are called; each literal makes a function of its own, whose name can be deleted and defined anew without a trace in the next one.
function frames(e) { return e.stack.split("\n").slice(1, 3).map(l => l.trim().replace(/\(.*[\\/]/, "(").replace(/at .*[\\/]/, "at ")).join(" | "); }
const literal = { [Symbol.dispose]() { const e = new Error("x"); return e; }, get [Symbol.toStringTag]() { return "T" + frames(new Error("g")); }, async [Symbol.asyncDispose]() { const e = new Error("a"); return e; }, *[Symbol.iterator]() { yield new Error("i"); }, [Symbol.toPrimitive]: function () { const e = new Error("p"); return e; }, [Symbol.hasInstance]: () => { const e = new Error("h"); return e; } };
class C { [Symbol.dispose]() { const e = new Error("x"); return e; } static [Symbol.hasInstance]() { const e = new Error("s"); return e; } get [Symbol.toStringTag]() { return "C"; } }
console.log(literal[Symbol.dispose].name, "|", Object.getOwnPropertyDescriptor(literal, Symbol.toStringTag).get.name, "|", literal[Symbol.asyncDispose].name, "|", literal[Symbol.iterator].name, "|", literal[Symbol.toPrimitive].name, "|", literal[Symbol.hasInstance].name);
console.log(C.prototype[Symbol.dispose].name, "|", C[Symbol.hasInstance].name, "|", Object.getOwnPropertyDescriptor(C.prototype, Symbol.toStringTag).get.name);
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(literal[Symbol.dispose], "name")), Reflect.ownKeys(literal[Symbol.dispose]).join(), Reflect.ownKeys(C.prototype[Symbol.dispose]).join());
console.log(literal[Symbol.toStringTag]);
console.log(frames([...literal][0]));
literal[Symbol.asyncDispose]().then(e => console.log(frames(e)));
console.log(Bun.inspect(literal[Symbol.dispose]), Bun.inspect(C.prototype[Symbol.dispose]), Bun.inspect({ [Symbol.dispose]() {} }));
console.log(String(literal[Symbol.dispose]).slice(0, 16), literal[Symbol.dispose].toString === Function.prototype.toString);
const two = () => ({ [Symbol.dispose]() {} }); console.log(two()[Symbol.dispose] === two()[Symbol.dispose], two()[Symbol.dispose].name);
const f = two()[Symbol.dispose]; console.log(delete f.name, f.name, Object.hasOwn(f, "name")); Object.defineProperty(f, "name", { value: "renamed" }); console.log(f.name, two()[Symbol.dispose].name);
for (let round = 0; round < 50; round++) { const o = two(); if (o[Symbol.dispose].name !== "[Symbol.dispose]" || Bun.inspect(o[Symbol.dispose]) !== "[Function]") console.log("wrong in round", round); }
const shadow = (Symbol => ({ [Symbol.dispose]() {} }))({ dispose: "mine" }); console.log(Reflect.ownKeys(shadow).map(String).join(), shadow.mine.name, Bun.inspect(shadow.mine));
