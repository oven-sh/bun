// Names that an instance of a class below Error has and has not are asked for with `in`, hasOwn and reads, in every order.
class K extends Error { v = 1; id: number; constructor(id: number) { super("m" + id); this.id = id; } }
class M extends Map<string, number> { v = 1; }
function only(u: any): unknown { return ["cause" in u, "nothing" in u, "id" in u, "v" in u, "message" in u, "stack" in u]; }
function readFirst(u: any): unknown { return [u.cause, "cause" in u, u.nothing, "nothing" in u, Object.hasOwn(u, "cause"), Object.hasOwn(u, "nothing")]; }
function hasFirst(u: any): unknown { return ["cause" in u, u.cause, "nothing" in u, u.nothing]; }
for (const make of [() => new K(1), () => new M(), () => new Error("plain"), () => new K(2)]) {
  console.log(JSON.stringify(only(make())), JSON.stringify(readFirst(make())), JSON.stringify(hasFirst(make())));
  const same = make();
  console.log(JSON.stringify(readFirst(same)), JSON.stringify(only(same)), JSON.stringify(hasFirst(same)), Object.keys(same).join(), Reflect.ownKeys(same).map(String).join());
}
console.log(JSON.stringify(readFirst(new (class extends Error { constructor() { super("with", { cause: 5 }); } })())));
