// A host function that refuses an operand describes it in its message: by the name of its constructor, and an object that has none with all its fields.
// Nothing else in the program reads these fields.
const bare = n => ({ __proto__: null, secret: 40 + n, other: "o" + n });
class Kind { secret = 50; other = "k"; }
const says = f => { try { f(); console.log("taken"); } catch (e) { console.log(e.message); } };
says(() => Buffer.alloc(bare(1)));
says(() => process.chdir(bare(2)));
says(() => setTimeout(bare(3)));
says(() => Buffer.concat([bare(4)]));
says(() => Buffer.byteLength(bare(5)));
says(() => queueMicrotask(bare(6)));
says(() => Buffer.alloc(new Kind()));
says(() => process.chdir({ secret: 60, other: "l" }));
