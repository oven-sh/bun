// The function that makes closures over its parameter is itself a closure: it captures variables with declared types, a variable that is assigned later, a function and `this`.
const lines: string[] = [];
const say = (...parts: unknown[]) => lines.push(parts.map(String).join(" "));
const hidden = process.argv.length > 9 ? "x" : "";
interface Box {
  width: number;
  height: number;
  [name: string]: number;
}
function outer(prefix: string, scale: number, box: Box, label?: string) {
  let calls = 0;
  const describe = (value: number) => prefix + value * scale + (label ?? "");
  function reader(name: string) {
    return () => {
      calls++;
      return describe(box[name]) + "#" + calls;
    };
  }
  const arrow = (name: string) => (by: number) => prefix + (box[name] += by);
  return { width: reader("width"), height: reader("height"), other: reader("wid" + hidden + "th"), grow: arrow("width"), shrink: arrow("height") };
}
class Shelf {
  boxes: Record<string, Box> = { low: { width: 1, height: 2 }, high: { width: 3, height: 4 } };
  constructor(public title: string) {}
  readers() {
    const pick = (name: string) => () => this.title + ":" + this.boxes[name].width;
    return [pick("low"), pick("high"), pick("lo" + hidden + "w")];
  }
}
const made = outer(">", 2, { width: 5, height: 6 });
say(made.width(), made.height(), made.other(), made.grow(1), made.shrink(-1), made.width());
const labelled = outer("<", 1, { width: 7, height: 8 }, "!");
say(labelled.width(), labelled.height(), made.height());
say(
  new Shelf("s")
    .readers()
    .map(read => read())
    .join(),
);
console.log(lines.join("\n"));
