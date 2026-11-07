// A list that is written out without a gap has no hole. It gets one by a store past its end, a longer length, a delete;
// and an element may become a getter. Whoever steps through the list then reads undefined, or what the getter answers.
const lines: string[] = [];
const show = (label: string, seen: string[]) => lines.push(`${label}: ${seen.join(" ")}`);

const whole = ["a", "b"];
{
  const seen: string[] = [];
  for (const each of whole) seen.push(each === undefined ? "hole" : each);
  show("whole", seen);
}

const writtenWithGap = ["a", , "c"];
{
  const seen: string[] = [];
  for (const each of writtenWithGap) seen.push(each === undefined ? "hole" : each);
  show("written with a gap", seen);
}

const storedPastEnd = ["a", "b"];
storedPastEnd[3] = "d";
{
  const seen: string[] = [];
  for (const each of storedPastEnd) seen.push(each === undefined ? "hole" : each);
  show("stored past the end", seen);
}

const madeLonger = ["a", "b"];
madeLonger.length = 3;
{
  const seen: string[] = [];
  for (const each of madeLonger) seen.push(each === undefined ? "hole" : each);
  show("made longer", seen);
}

const deleted = ["a", "b"];
delete deleted[0];
{
  const seen: string[] = [];
  for (const each of deleted) seen.push(each === undefined ? "hole" : each);
  show("deleted", seen);
}

const deletedByReflect = ["a", "b"];
Reflect.deleteProperty(deletedByReflect, 1);
{
  const seen: string[] = [];
  for (const each of deletedByReflect) seen.push(each === undefined ? "hole" : each);
  show("deleted by Reflect", seen);
}

const redefined: (string | undefined)[] = ["a", "b"];
Object.defineProperty(redefined, 1, { get: () => undefined });
{
  const seen: string[] = [];
  for (const each of redefined) seen.push(each === undefined ? "hole" : each);
  show("redefined", seen);
}

const assigned = ["a", "b"];
Object.assign(assigned, { 4: "e" });
{
  const seen: string[] = [];
  for (const each of assigned) seen.push(each === undefined ? "hole" : each);
  show("assigned", seen);
}

const storedWhileStepping = ["a", "b"];
{
  const seen: string[] = [];
  for (const each of storedWhileStepping) {
    if (each === "a") storedWhileStepping[3] = "d";
    seen.push(each === undefined ? "hole" : each);
  }
  show("stored while stepping", seen);
}

function lengthen(list: string[]) {
  list.length += 1;
}
const lengthenedElsewhere = ["a", "b"];
lengthen(lengthenedElsewhere);
{
  const seen: string[] = [];
  for (const each of lengthenedElsewhere) seen.push(each === undefined ? "hole" : each);
  show("made longer by a function", seen);
}

const holder = { list: ["a", "b"] };
(holder as Record<string, string[]>)["li" + "st"][2 + whole.length] = "e";
{
  const seen: string[] = [];
  for (const each of holder.list) seen.push(each === undefined ? "hole" : each);
  show("stored through a computed name", seen);
}

const intoSet = ["a", "b"];
intoSet[2 + 1] = "d";
{
  const seen: string[] = [];
  for (const each of new Set(intoSet)) seen.push(each === undefined ? "hole" : each);
  show("into a Set", seen);
}

const gapIntoSet = new Set(["a", , "c"]);
{
  const seen: string[] = [];
  for (const each of gapIntoSet) seen.push(each === undefined ? "hole" : each);
  show("a gap into a Set", seen);
}

const spread = ["a", "b"];
spread.length = 3;
{
  const seen: string[] = [];
  for (const each of [...spread]) seen.push(each === undefined ? "hole" : each);
  show("spread", seen);
}

const copied = ["a", "b"];
delete copied[1];
{
  const seen: string[] = [];
  for (const each of Array.from(copied)) seen.push(each === undefined ? "hole" : each);
  show("copied by Array.from", seen);
}

const keysAndValues = ["a", "b"];
keysAndValues[3] = "d";
{
  const seen: string[] = [];
  for (const [index, each] of keysAndValues.entries()) seen.push(`${index}=${each === undefined ? "hole" : each}`);
  show("entries", seen);
}

const pushed = ["a", "b"];
pushed.push("c");
{
  const seen: string[] = [];
  for (const each of pushed) seen.push(each === undefined ? "hole" : each);
  show("pushed", seen);
}

const [first, second, third] = ["a", "b"] as (string | undefined)[];
show("taken apart past the end", [first ?? "none", second ?? "none", third === undefined ? "none" : third]);

console.log(lines.join("\n"));
