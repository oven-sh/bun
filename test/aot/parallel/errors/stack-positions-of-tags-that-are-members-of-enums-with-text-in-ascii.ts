// The same program as stack-positions-of-tags-that-are-members-of-enums-with-text-that-is-not-ascii.ts with the text of each template in ASCII. Bun's transpiler prints these tagged templates as they are written, behind the comment with the name of the member. JSC reports the call of such a tag at its backquote: a stack trace names the backquote.
enum Kind {
  A = "a",
  N = 7,
}
const enum Fixed {
  B = 2,
}
const inThisFile = /stack-positions-of-tags-that-are-members-of-enums-with-text-in-ascii/;
function show(label: string, run: () => void) {
  try {
    run();
    console.log(label, "| nothing is thrown");
  } catch (error: any) {
    const lines = String(error.stack)
      .split("\n")
      .filter(line => inThisFile.test(line));
    console.log(label, "|", error.name, "|", lines.map(line => /:(\d+:\d+)\)?$/.exec(line)![1]).join(" "));
  }
}
// prettier-ignore
{
show("a tag that is a member of an enum with a text", () => {
  (Kind.A as any)
    `e`;
});
show("a tag that is a member of an enum with a number", () => {
  (Kind.N as any)
    `e`;
});
show("a tag that is a member of a constant enum", () => {
  (Fixed.B as any)
    `e`;
});
show("a tag that is a member of an enum, with a value", () => {
  (Kind.A as any)
    `e${
      1}`;
});
}
