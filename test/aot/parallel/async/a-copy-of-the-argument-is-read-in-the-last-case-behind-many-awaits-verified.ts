// An async function copies its argument, awaits many times in the first cases of a switch, and reads a field of the copy in the last one.
// Another object of the same type gets a property under a computed name, so a read of the field tests the slot first.
// Flags: --aot-check=verify-each-stage
const MARK = Symbol("mark");
type Place = { name: string; test?: (name: string) => boolean; depth?: number; note?: string; [MARK]?: boolean };

let steps = 0;
async function step(n: number) {
  steps += n;
  return n;
}

function define(place: Place, key: string) {
  Object.defineProperty(place, key, { value: 7, configurable: true, enumerable: true, writable: true });
  return place.depth;
}
console.log(define({ name: "defined" }, process.argv.length > 9 ? "name" : "depth"));

async function visit(kind: string, asked: Place) {
  const { [MARK]: marked, ...rest } = asked;
  const place: Place = { ...rest, test: undefined };
  switch (kind) {
    case "first": {
      await step(1);
      await step(1);
      await step(1);
      await step(1);
      await step(1);
      await step(1);
      await step(1);
      await step(1);
      await step(1);
      return "first " + place.name;
    }
    case "second": {
      await step(1);
      await step(1);
      await step(1);
      await step(1);
      await step(1);
      await step(1);
      await step(1);
      await step(1);
      await step(1);
      return "second " + place.name;
    }
    case "third": {
      if (!(await step(1))) return "none";
      const length = await step(place.name.length);
      return "third " + length + " " + place.name + " " + marked + " " + place.depth;
    }
  }
  return "other";
}

const said: string[] = [];
for (const kind of ["first", "second", "third", "fourth"]) {
  said.push(await visit(kind, { name: "one" }));
  said.push(await visit(kind, { name: "two", depth: 2 }));
  said.push(await visit(kind, { depth: 3, name: "three", note: "x", [MARK]: true }));
}
console.log(said.join("\n"));
console.log(steps);
