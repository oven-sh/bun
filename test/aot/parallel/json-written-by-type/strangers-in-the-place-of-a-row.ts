// what arrives is not what is written: a proxy whose traps are logged, an object of another class with the same members, Object.create of the prototype, a parsed object, a spread, a list, a primitive, undefined and null
// COUNT: operation:operationAOTStringBuilderBegin >= 1
class Row {
  id: number;
  name: string;
  constructor(id: number, name: string) {
    this.id = id;
    this.name = name;
  }
}
class Twin {
  id = 7;
  name = "twin";
  toJSON() {
    return "a twin";
  }
}
function write(row: Row): string {
  return JSON.stringify(row);
}
const log: string[] = [];
for (let i = 0; i < 3; i++) console.log(write(new Row(i, "n" + i)));
console.log(
  write(
    new Proxy(new Row(4, "target"), {
      get(target, key, receiver) {
        log.push("get " + String(key));
        return Reflect.get(target, key, receiver);
      },
      ownKeys(target) {
        log.push("ownKeys");
        return ["name", "id"];
      },
      getOwnPropertyDescriptor(target, key) {
        log.push("descriptor " + String(key));
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    }),
  ),
);
console.log(log.join());
console.log(write(new Twin() as any));
console.log(write(Object.create(Row.prototype)));
console.log(write(JSON.parse('{"id":5,"name":"parsed"}')));
console.log(write({ ...new Row(6, "spread") }));
console.log(write([1, "two"] as any));
console.log(write("text" as any), write(7 as any), write(true as any), write(null as any), write(undefined as any));
console.log(write((() => 1) as any), write(Symbol("s") as any));
console.log(write(new Row(8, "whole")));
