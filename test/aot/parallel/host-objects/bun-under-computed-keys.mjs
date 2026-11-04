// No member of Bun is spelled here. A key that the build cannot read may be any name, so all of them are there.
const made = (...parts) => parts.join("");
const names = value => Object.getOwnPropertyNames(value).sort().join();
const shell = Bun[made("$")];
const sql = Bun[made("s", "ql")];
console.log(typeof shell, typeof shell.braces, shell[made("bra", "ces")]("a{b,c}").join());
console.log(names(shell), names(Object.getPrototypeOf(shell)));
console.log((await shell`echo hi`.text()).trim());
console.log(typeof sql, typeof sql.begin, typeof sql[made("un", "safe")], names(sql));
console.log(names({ ...Bun }[made("$")]), typeof Object.create(Bun)[made("$")].escape, typeof Reflect.get(Bun, made("S", "QL")).prototype);
for (const name in Bun) if (name.length === 1) console.log(name, names(Bun[name]));
console.log(typeof new Map(Object.entries(Bun)).get(made("s", "ql")).end);
