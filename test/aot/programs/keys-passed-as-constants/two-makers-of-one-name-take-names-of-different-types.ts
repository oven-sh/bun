// Two classes have a method of one name that makes a closure over its parameter. The parameter of one is a union of two texts, that of the other any text, a third takes a key of a type parameter, a fourth a member of an enum.
const lines: string[] = [];
const say = (...parts: unknown[]) => lines.push(parts.map(String).join(" "));
const hidden = process.argv.length > 9 ? "x" : "";
class Narrow {
  values = { a: 1, b: 2 };
  reader(name: "a" | "b") {
    return () => this.values[name];
  }
}
class Wide {
  values: Record<string, number> = { a: 10, zebra: 20, c: 30 };
  reader(name: string) {
    return () => this.values[name];
  }
}
class Keyed<T extends object> {
  constructor(public values: T) {}
  reader<K extends keyof T>(name: K) {
    return () => this.values[name];
  }
}
enum Color {
  Red = "red",
  Blue = "blue",
}
class Painted {
  values = { red: 100, blue: 200 };
  reader(name: Color) {
    return () => this.values[name];
  }
}
class Numbered {
  values = [7, 8, 9];
  reader(name: number) {
    return () => this.values[name];
  }
}
const narrow = new Narrow(),
  wide = new Wide(),
  keyed = new Keyed({ left: "l", right: "r" }),
  painted = new Painted(),
  numbered = new Numbered();
say(narrow.reader("a")(), narrow.reader("b")());
say(wide.reader("a")(), wide.reader("zebra")(), wide.reader("c" + hidden)(), wide.reader("left")());
say(keyed.reader("left")(), keyed.reader("right")());
say(painted.reader(Color.Red)(), painted.reader(Color.Blue)());
say(numbered.reader(0)(), numbered.reader(2)());
console.log(lines.join("\n"));
