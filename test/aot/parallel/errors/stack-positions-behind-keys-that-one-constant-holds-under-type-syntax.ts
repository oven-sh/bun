// Prints where errors are reported behind an element whose key is a constant that the element in front of it has as its key too, with syntax of types around the keys, and with a constant that a namespace exports. Bun's transpiler prints the value of the constant in place of both names, and its source map takes no second entry in a row for one place: what follows is found at the `[` in front of the second key.

const holder: any = { list: [[]] };
const use = (...values: any[]) => values.length;
const inThisFile = /stack-positions-behind-keys-that-one-constant-holds-under-type-syntax/;
function show(label: string, run: () => unknown) {
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
namespace Space {
  export const zero = 0;
  export function twice() {
    return holder.list[zero][zero].member;
  }
}
// prettier-ignore
{
show("a member behind two elements by one constant, each key with as", () => {
  const zero = 0;
  use(holder.list[zero as number][zero as number].member);
});
show("a member behind two elements by one constant, each key with !", () => {
  const zero = 0;
  use(holder.list[zero!][zero!].member);
});
show("a member behind two elements by one constant that a namespace exports", () => {
  Space.twice();
});
}
