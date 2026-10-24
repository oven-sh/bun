// Two unrelated classes and a plain literal satisfy one interface with an optional field; one function reads and fills all three kinds.
// The prototype of one class gets the name. The function must go on treating the other class and the literals as before.
const log: string[] = [];
interface Named {
  id: number;
  alias?: string;
}
class User implements Named {
  declare id: number;
  declare alias?: string;
  constructor(id: number) {
    this.id = id;
  }
}
class Group implements Named {
  declare id: number;
  declare alias?: string;
  declare members?: number;
  constructor(id: number) {
    this.id = id;
  }
}
function aliasOf(named: Named) {
  return named.alias;
}
function ensureAlias(named: Named) {
  if (named.alias === undefined) named.alias = "alias " + named.id;
  return named.alias;
}
function either(named: User | Group) {
  return named.alias ?? "none";
}
function state(named: Named) {
  return `${aliasOf(named)} ${"alias" in named} [${Object.keys(named)}]`;
}
function three(base: number): Named[] {
  return [new User(base), new Group(base + 1), { id: base + 2 }];
}

let length = 0;
for (let i = 0; i < 3000; i++) {
  for (const named of three(i & 7)) {
    length += aliasOf(named)?.length ?? 1;
    if (i & 1) length += ensureAlias(named).length;
  }
  length += either(new User(i)).length + either(new Group(i)).length;
}
console.log("warm", length);

const old = three(10);
Object.defineProperty(Object.getPrototypeOf(old[1]), "alias", {
  get(this: Group) {
    return undefined;
  },
  set(this: Group, value: string) {
    log.push(`${value} offered to group ${this.id}`);
  },
  configurable: true,
});
console.log("the group's prototype has accessors:", old.map(state).join(" | "), "|", three(20).map(state).join(" | "));
console.log("ensure:", old.map(ensureAlias).join(" | "), "|", log.join(", "));
console.log("after:", old.map(state).join(" | "), "|", either(new User(1)), either(new Group(2)));
(User.prototype as any)["alias"] = "every user";
console.log("the user's prototype has a value:", three(30).map(state).join(" | "), "|", either(new User(1)), either(new Group(2)));
console.log("ensure:", three(40).map(ensureAlias).join(" | "));
delete (User.prototype as any).alias;
delete (Group.prototype as any).alias;
console.log("gone again:", three(50).map(state).join(" | "), "|", three(60).map(ensureAlias).join(" | "));
