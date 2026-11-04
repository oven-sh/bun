const told: string[] = [];
function seen(_target: object, key: any, third?: any): void {
  told.push(`${typeof key} ${String(key)}${typeof third === "number" ? " at " + third : ""}`);
}
enum Level {
  Low = 3,
  Name = "text",
}
const count = 9, big = 12n, yes = true, none = null, mark = Symbol("mark");
class Marked {
  @seen 5() {}
  @seen 1.5 = 0;
  @seen "7"() {}
  @seen [8]() {}
  @seen ["9"]() {}
  @seen 0x10() {}
  @seen 1e21() {}
  @seen 4n() {}
  @seen [-1]() {}
  @seen [1 + 1]() {}
  @seen [Level.Low]() {}
  @seen [Level.Name]() {}
  @seen [-Level.Low]() {}
  @seen [count]() {}
  @seen [big as any]() {}
  @seen [yes as any]() {}
  @seen [none as any]() {}
  @seen [mark]() {}
  @seen [Symbol.iterator]() {}
  @seen get 33() {
    return 1;
  }
  @seen static 30() {}
  @seen static [31] = 1;
  36(@seen _first: number) {}
}
console.log(told.join("\n"));
console.log(Object.getOwnPropertyNames(Marked.prototype).join(), Object.keys(new Marked()).join(), Object.keys(Marked).join());
