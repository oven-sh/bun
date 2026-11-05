// A list that JSON.parse made takes instances of a class, while other parsed data is handed to Promise.resolve and read again behind `await` and in a reaction. What JSON.parse makes is an ordinary object or an array and never a promise: Promise.resolve wraps it in a new promise, `then` of that promise is the built-in, and no code that the compiler does not see runs. So `push` on the list is Array.prototype.push, the instances stay with the program, and their fields are read without allowing for other objects.
// IR+ ^layout L\d+ .*name="Awaited" .* neverEscapes=true
// IR+ ^layout L\d+ .*name="InAReaction" .* neverEscapes=true
// IR- ^layout (L\d+) .*name="Awaited" [\s\S]* receivers=\[[^\]\n]*\b\1\b[^\]\n]*\.\.\]
// IR- ^layout (L\d+) .*name="InAReaction" [\s\S]* receivers=\[[^\]\n]*\b\1\b[^\]\n]*\.\.\]
class Awaited { private hidden: number = 1; sum(): number { return this.hidden + 1; } }
class InAReaction { private hidden: number = 2; sum(): number { return this.hidden + 1; } }

const settled: any = Promise.resolve(JSON.parse('{"field":"an object"}'));
console.log("awaited:", (await settled).field);
const awaited: Awaited[] = JSON.parse("[]");
awaited.push(new Awaited());
console.log("pushed behind it:", awaited.length, awaited[0].sum());

const list: any = Promise.resolve(JSON.parse('["an array"]'));
await list.then((value: any) => console.log("in a reaction:", value[0], Array.isArray(value)));
const inAReaction: InAReaction[] = JSON.parse("[]");
inAReaction.push(new InAReaction());
console.log("pushed behind it:", inAReaction.length, inAReaction[0].sum());

// Data with a member called `then` is no thenable either: the member is data, not a function.
const named: any = await Promise.resolve(JSON.parse('{"then":"only a text"}'));
console.log("a member called then:", named.then);
// A promise is still handed back as it is.
const same = Promise.resolve(1);
console.log("a promise:", Promise.resolve(same) === same, await same);
