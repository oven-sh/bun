// In each shape the result of exec | match is seen by somebody on some way, so the array has to be there for whoever takes it. What is printed is what plain Bun prints.
const unseen = (x: any): any => [x][JSON.parse("0")];
const lines: string[] = unseen(["color=red", "plain", "size=big"]);
const told: string[] = [];
const kept: any[] = [];

function describe(m: any): string {
  if (m === null) return "null";
  return [Array.isArray(m), m.length, m.index, m.input, String(m.groups), Object.keys(m).join("+"), JSON.stringify(m)].join(" ");
}
function returnedOnOneWay(line: string, keep: boolean): any {
  const m = /^([a-z]+)=(.*)$/.exec(line);
  if (m) {
    if (keep) return m;
    return m[1];
  }
  return "none";
}
function storedOnOneWay(line: string, keep: boolean): string {
  const m = /^([a-z]+)=(.*)$/.exec(line);
  if (!m) return "none";
  if (keep) kept.push(m);
  return m[2]!;
}
function changedByOthers(line: string, change: (m: RegExpExecArray) => void): string {
  const m = /^([a-z]+)=(.*)$/.exec(line);
  if (!m) return "none";
  change(m);
  return m[1] + "," + m.index + "," + m.length + "," + m.input;
}
function changedHere(line: string): string {
  const m = /^([a-z]+)=(.*)$/.exec(line);
  if (!m) return "none";
  const before = m[1];
  m[1] = "written";
  m.index = 40;
  m.length = 2;
  return before + "," + m[1] + "," + m.index + "," + m.length + "," + String(m[2]);
}
function readAtAnyPlace(line: string, place: number): string {
  const m = /^([a-z]+)=(.*)$/.exec(line);
  if (!m) return "none";
  return String(m[place]) + m[1];
}
function comparedWithItself(line: string): string {
  const m = /^([a-z]+)=(.*)$/.exec(line);
  const other = /^([a-z]+)=(.*)$/.exec(line);
  if (!m) return "none";
  const same: any = m;
  return String(m === same) + String(m === (other as any)) + m[1];
}
function meetsAnother(line: string, list: string[]): string {
  const m = /^([a-z]+)=(.*)$/.exec(line);
  const either = m ? m : list;
  return either[1] + "/" + either.length;
}
function closedOver(line: string): () => string {
  const m = /^([a-z]+)=(.*)$/.exec(line);
  if (!m) return () => "none";
  return () => m[1] + m[2];
}
function spread(line: string): string {
  const m = /^([a-z]+)=(.*)$/.exec(line);
  if (!m) return "none";
  return [...m].join("|") + m[1];
}
function named(line: string): string {
  const m = /^(?<key>[a-z]+)=(?<value>.*)$/.exec(line);
  if (!m) return "none";
  return m.groups!.key + m[2] + Object.keys(m.groups!).join();
}
function places(line: string): string {
  const m = /^([a-z]+)=(.*)$/d.exec(line);
  if (!m) return "none";
  return JSON.stringify((m as any).indices) + m[1];
}
function thrownAway(line: string): string {
  try {
    const m = /^([a-z]+)=(.*)$/.exec(line);
    if (!m) throw new Error("none");
    return m[1]!;
  } catch (error) {
    return (error as Error).message;
  }
}
function legacy(line: string): string {
  const m = /^([a-z]+)=(.*)$/.exec(line);
  if (!m) return "none";
  return m[1] + (RegExp as any).$2 + (RegExp as any).lastMatch;
}

for (const line of lines) {
  for (const keep of [false, true]) {
    const returned = returnedOnOneWay(line, unseen(keep));
    told.push(typeof returned === "string" ? returned : describe(returned));
    told.push(storedOnOneWay(line, unseen(keep)));
  }
  told.push(changedByOthers(line, unseen((m: any) => { m[1] = "spoiled"; m.index = 7; m.push("more"); m.input = "other"; })));
  told.push(changedByOthers(line, unseen((m: any) => { Object.defineProperty(m, 1, { get: () => "got" }); })));
  told.push(changedByOthers(line, unseen(() => {})));
  told.push(changedHere(line), readAtAnyPlace(line, unseen(2)), readAtAnyPlace(line, unseen(9)), comparedWithItself(line));
  told.push(meetsAnother(line, unseen(["x", "y", "z", "w"])), closedOver(line)(), spread(line), named(line), places(line), thrownAway(line), legacy(line));
}
for (const m of kept) told.push(describe(m));
told.push(String(kept[0] === kept[0]), String(kept[0] === kept[1]));
console.log(told.join("\n"));
