// Exports of start-up modules: console.log calls the custom inspect method with (number, object, function), while the program itself only ever passes three strings.
const custom = Symbol.for("nodejs.util.inspect.custom");

class Box {
  [custom](depth: string, options: string, inspect: string): string {
    let seen = 0;
    seen += typeof depth === "string" ? 1 : typeof depth === "number" ? 20 : 300;
    seen += typeof options === "string" ? 1000 : typeof options === "object" ? 20000 : 300000;
    seen += typeof inspect === "string" ? 1000000 : typeof inspect === "function" ? 20000000 : 300000000;
    return String(seen);
  }
}

const box = new Box();
const own = Number(box[custom]("a", "b", "c"));
console.log(box, own);
