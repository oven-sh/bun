// The program spells the name of a member of Bun, hands it to a function made of text that the build cannot see, and reads Bun under what comes back.
// Alone: what it prints depends on what else the executable holds: which members of Bun were compiled in
const launder = Function("value", process.argv[9] ?? "return value");

const shell = Reflect.get(Bun, launder("$"));
console.log((await shell`echo hi`.text()).trim());

const { name } = launder({ name: "peek" });
console.log(Bun[`${name}`](Promise.resolve(3)));

const SQL = launder(Bun)[launder(["SQL"])[0]];
console.log(typeof new SQL("postgres://127.0.0.1:1/x").begin);
