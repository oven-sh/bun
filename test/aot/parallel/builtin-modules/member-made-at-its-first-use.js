// The function object of a built-in is made at its first use in compiled code, and its holder, which makes the member at the first read, gets a slot for it then.
function describe(run) { try { return String(run()); } catch (error) { return error.constructor.name + ": " + (error.code ?? "no code"); } }
console.log("a rejected argument:", describe(() => Buffer.compare({}, Buffer.alloc(1))));
console.log("accepted:", describe(() => Buffer.compare(Buffer.from("a"), Buffer.from("b"))));
console.log("the same function:", Buffer.compare === Reflect.get(Buffer, "compare"), Object.getOwnPropertyDescriptor(Buffer, "compare").value === Buffer.compare);
console.log("another member:", describe(() => Buffer.byteLength(5)), describe(() => Buffer.byteLength("five5")));
console.log("of another holder:", describe(() => Object.groupBy(null, x => x)), describe(() => JSON.stringify(Object.groupBy([1, 2, 3], x => x & 1))));
console.log("of a prototype:", describe(() => Array.prototype.toSorted.call(null)), describe(() => [3, 1, 2].toSorted()));
