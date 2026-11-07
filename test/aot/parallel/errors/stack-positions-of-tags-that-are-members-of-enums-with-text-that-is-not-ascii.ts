// Prints where the call of a tag is reported that is a member of an enum, with a template that starts a line and holds text that is not ASCII. Bun's transpiler prints the value of the member with the name of the member in a comment behind it, and such a template as a call of the tag. JSC reports that call where the value ends, in front of the comment: a stack trace names the value, as it does for any call of such a member.
enum Kind {
  A = "a",
  N = 7,
}
const enum Fixed {
  B = 2,
}
const inThisFile = /stack-positions-of-tags-that-are-members-of-enums-with-text-that-is-not-ascii/;
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
    `é`;
});
show("a tag that is a member of an enum with a number", () => {
  (Kind.N as any)
    `é`;
});
show("a tag that is a member of a constant enum", () => {
  (Fixed.B as any)
    `é`;
});
show("a tag that is a member of an enum, with a value", () => {
  (Kind.A as any)
    `é${
      1}`;
});
}
