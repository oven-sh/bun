// A message quotes a member of an enum as the program writes it. `bun run` and a bundle quote what the transpiler has put in its place: 'table[1 /* Closed */].title'.
// docs/compiler/compatibility.mdx, "Error messages". Plain Bun prints another output.
enum Kind { Open, Closed }
enum Mode { Dark = "dark" }
const unseen = (x: any) => [x][JSON.parse("0")];
const table: any = unseen({});
const say = (f: () => unknown) => { try { f(); console.log("no throw"); } catch (e) { console.log((e as Error).message); } };
say(() => table[Kind.Closed].title);
say(() => table[Kind.Open]());
say(() => table.pick(Mode.Dark));
/* Output:
undefined is not an object (evaluating 'table[Kind.Closed].title')
table[Kind.Open] is not a function. (In 'table[Kind.Open]()', 'table[Kind.Open]' is undefined)
table.pick is not a function. (In 'table.pick(Mode.Dark)', 'table.pick' is undefined)
*/
