// Every store of displayName in this program has a receiver whose declared type is an object type. Objects arrive there, and once each, against the type, a function object. In a loop, in code that seldom runs, and in code that runs once.
type Labeled = { id: number; displayName?: string };
const names = (stack: string) =>
  stack
    .split("\n")
    .slice(1, 3)
    .map(line =>
      line
        .trim()
        .replace(/ ?\(.*\)$/, "")
        .replace(/^at /, "")
        .replace(/^.*\.ts:.*$/, "module"),
    )
    .join(" < ");
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never) as <T>(value: T) => T;
let last = "";
const make = () =>
  function plain() {
    last = new Error("x").stack!;
    return 0;
  };
const turns: number = handedBack(3);

function label(one: Labeled, text: string) {
  one.displayName = text;
}
function labelSeldom(one: Labeled, text: string) {
  try {
    if (one.id < 0) throw new Error("seldom");
  } catch {
    one.displayName = text;
  }
}
function show(title: string, renamed: () => number, sibling: () => number) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += renamed();
  const first = names(last);
  for (let i = 0; i < turns; i++) sum += sibling();
  console.log(title, "|", first, "|", names(last), "|", (renamed as unknown as Labeled).displayName, sum);
}

const before = handedBack(make());
show("nothing renamed yet", before, before);

// The objects stay where the compiler sees them: code that it does not see could copy a displayName from them to a function.
const objects: Labeled[] = [{ id: 1 }, { id: 2 }, { id: 3 }];
const inLoop = handedBack(make()),
  besideInLoop = handedBack(make());
const mixed: Labeled[] = [...objects, inLoop as unknown as Labeled];
for (let i = 0; i < mixed.length; i++) label(mixed[i]!, "inLoop" + i);
show("in a loop", inLoop, besideInLoop);

labelSeldom({ id: -1 }, "object");
const seldom = handedBack(make()),
  besideSeldom = handedBack(make());
(seldom as unknown as { id: number }).id = -1;
labelSeldom(seldom as unknown as Labeled, "seldom");
show("seldom", seldom, besideSeldom);

const once = handedBack(make()),
  besideOnce = handedBack(make());
const typedOnce: Labeled = handedBack(once as unknown as Labeled);
typedOnce.displayName = "once";
show("once", once, besideOnce);
show("the first again", inLoop, before);
console.log(objects.map(object => object.displayName).join());
