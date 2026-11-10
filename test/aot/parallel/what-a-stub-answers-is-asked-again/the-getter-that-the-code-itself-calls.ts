// Flags: --aot-testing=CheckWalkAtRunTime
// Where Link expects one function as the getter at a read, the code looks the getter up without running it, tests what it found and calls it itself. Under the word that checks the walk what that lookup hands back is held against a second lookup of receiver and name.
// The lookup begins to answer after some hundred misses of its place: of 27,000 reads all but those are called by the code itself, and each is held against a second lookup. Where the stub hands back the other half of the accessor the program stays right as built, by the read as written, and stops by name under the word.
// At the end one accessor keeps a setter alone: the stub hands back the function that the engine keeps in the place of a getter, which is no getter: a first form of the check rang there.
// COUNTER: FastPathResultsVerified >= 25000
const names: string[] = []; for (let i = 0; i < 6; i++) names.push("n" + i);
function getterOf(name: string, weight: number, holder: object) { return function (this: unknown) { return name + ":" + weight + ":" + (this === holder ? "own" : "other"); }; }
function build(weight: number): any { const flags: any = Object.create(null); for (let k = 0; k < names.length; k++) { const name = names[k]; Object.defineProperty(flags, name, { get: getterOf(name, weight, flags), enumerable: true, configurable: true }); } return flags; }
const flags = build(1);
function three() { return flags.n1 + " " + flags.n3 + " " + flags.n5; }
let text = ""; for (let i = 0; i < 3000; i++) text = three();
console.log(text);
Object.defineProperty(flags, "n3", { get: getterOf("other", 2, flags), configurable: true });
for (let i = 0; i < 3000; i++) text = three();
console.log(text);
delete flags.n5;
for (let i = 0; i < 300; i++) text = three();
Object.defineProperty(flags, "n5", { set(value: unknown) {}, configurable: true });
for (let i = 0; i < 3000; i++) text = three();
console.log(text);
