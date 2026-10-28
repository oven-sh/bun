// Symbols and names of one object are deleted and added again, in every order; the object and its copies are printed after each step.
function pick(name: string): any {
  return (Symbol as any)[name];
}
function show(label: string, made: any) {
  console.log(label, made);
  console.log(label, "own keys", Reflect.ownKeys(made));
  console.log(label, "assigned", Object.assign({}, made));
  console.log(label, "spread", { ...made });
}
const first = pick("asyncDispose");
const second = pick("iterator");
const third = pick("hasInstance");
function make(): any {
  return { [first]: 1, size: 2, [second]: 3, count: 4 };
}
let made = make();
delete made[first];
show("first symbol deleted", made);
made[first] = 5;
show("and added again", made);
made = make();
delete made.size;
show("first name deleted", made);
made.size = 5;
show("and added again", made);
made = make();
delete made[second];
made.more = 5;
show("second symbol deleted, a name added", made);
made = make();
delete made.count;
made[third] = 5;
made.count = 6;
show("last name deleted, a symbol and the name added", made);
made = make();
delete made[first];
delete made[second];
show("both symbols deleted", made);
made = make();
delete made.size;
delete made.count;
show("both names deleted", made);
made.count = 1;
made.size = 2;
show("both names added the other way round", made);
made = make();
for (let i = 0; i < 40; i++) made["key" + i] = i;
made[third] = 1;
made.last = 2;
console.log(
  "many",
  Reflect.ownKeys(made).length,
  Bun.inspect(made)
    .split("\n")
    .filter(line => line.includes("Symbol") || line.includes("last") || line.includes("size")),
);
const list: any[] = [];
for (let i = 0; i < 6; i++) {
  const each: any = {};
  if (i & 1) each[first] = i;
  each.size = i;
  if (i & 2) each[second] = i;
  each.count = i;
  if (i & 4) each[third] = i;
  list.push(each);
}
console.log(list);
