// Prints where errors are reported behind a member of a namespace that another block of the namespace reads by its name alone. Bun's transpiler prints such a name as a member, `Held.holder`, which is no name: the `.`, the `?.`, the `[` and the backquote behind it are mapped where they start a line, as behind any other member. A call is reported where the name ends, and the `[` of a name in quotes has no mapping.
const nothing: any = () => undefined;
const key = () => "name";
namespace Held {
  export const holder: any = nothing();
  export const reader: any = {
    get name() {
      throw new Error("read");
    },
  };
}
const inThisFile = /stack-positions-behind-members-of-a-namespace/;
function show(label: string, run: () => unknown) {
  try {
    run();
    console.log(label, "| nothing is thrown");
  } catch (error: any) {
    const lines = String(error.stack).split("\n").filter(line => inThisFile.test(line));
    console.log(label, "|", error.name, "|", lines.map(line => /:(\d+:\d+)\)?$/.exec(line)![1]).slice(0, 2).join(" "));
  }
}
// prettier-ignore
namespace Held {
  show("a member", () => {
    return holder
      .name;
  });
  show("a member behind ?.", () => {
    return reader
      ?.name;
  });
  show("a member of a member", () => {
    return reader
      .name
      .length;
  });
  show("an element", () => {
    return holder
      [key()];
  });
  show("an element by a name in quotes", () => {
    return holder
      ["name"];
  });
  show("a store to a member", () => {
    holder
      .name = 1;
  });
  show("a store to an element", () => {
    holder
      [key()] = 1;
  });
  show("a call of a member", () => {
    return holder
      .name();
  });
  show("a tag", () => {
    return holder
      `text`;
  });
  show("a tag with a value", () => {
    return holder
      `text ${1}`;
  });
  show("a call", () => {
    return holder
      (1);
  });
  show("a call behind ?.", () => {
    return reader
      ?.(1);
  });
  show("a member on the line of the name", () => {
    return holder.name;
  });
  show("an element on the line of the name", () => {
    return holder[key()];
  });
  show("a member below a function that reads it", () => {
    const read = () => holder
      .name;
    return read();
  });
}
