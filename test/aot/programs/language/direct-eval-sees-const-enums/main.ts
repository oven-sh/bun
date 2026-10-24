// A direct eval sees the `const` enums that its file declares, or imports and uses, as objects, the same as it sees other enums: plain Bun keeps them, and a file that has both must build.
import { Color, Shape, Word } from "./colors";
const enum Size { Small = 1, Large = Small * 4 }
function show(label: string, run: () => unknown): void {
  try {
    console.log(label, JSON.stringify(run()));
  } catch (error) {
    console.log(label, (error as Error).constructor.name);
  }
}
console.log(Color.Green, Color.Blue, Word.No, Shape.Square, Size.Large);
show("types", () => eval("[typeof Color, typeof Word, typeof Shape, typeof Size]"));
show("members", () => eval("[Color.Green, Color.Blue, Word.No, Shape.Square, Size.Large]"));
show("names of values", () => eval("[Color[2], Shape[1], Size[4], Word.yes]"));
show("keys", () => eval("[Object.keys(Color), Object.keys(Word), Object.keys(Size)]"));
show("the same object each time", () => eval("Color") === eval("Color") && eval("Size") === eval("Size"));
function inner(): unknown {
  const enum Local { One = 1 }
  return [Local.One, eval("typeof Local"), eval("Local.One")];
}
show("declared in a function", inner);
