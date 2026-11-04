// Prints where errors are reported behind a member of an enum that another block of the enum reads by its name alone. The value of the member is not known when the file is parsed, so Bun's transpiler prints the name as a member, `Level.Low`, which is no name: the `.`, the `[` and the backquote behind it are mapped where they start a line, as behind any other member. A call is reported where the name ends.
const nothing: any = () => undefined;
const key = () => "name";
const rows: [string, () => unknown][] = [];
function keep(...added: [string, () => unknown][]): number {
  return rows.push(...added);
}
enum Level {
  Low = nothing(),
}
// prettier-ignore
enum Level {
  High = keep(
    ["a member", () => (Low as any)
      .name],
    ["an element", () => (Low as any)
      [key()]],
    ["an element by a name in quotes", () => (Low as any)
      ["name"]],
    ["a store to a member", () => { (Low as any)
      .name = 1; }],
    ["a tag", () => (Low as any)
      `text`],
    ["a call", () => (Low as any)
      (1)],
    ["a member on the line of the name", () => (Low as any).name],
  ),
}
const inThisFile = /stack-positions-behind-members-of-an-enum/;
for (const [label, run] of rows) {
  try {
    run();
    console.log(label, "| nothing is thrown");
  } catch (error: any) {
    const lines = String(error.stack).split("\n").filter(line => inThisFile.test(line));
    console.log(label, "|", error.name, "|", /:(\d+:\d+)\)?$/.exec(lines[0])![1]);
  }
}
