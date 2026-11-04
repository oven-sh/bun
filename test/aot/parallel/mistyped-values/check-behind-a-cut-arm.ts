// A parameter is checked where it is used, behind an arm that every call leaves out. Typing the split body cuts that arm, and the values that stay get other numbers: the check is asked for under its new one.
interface Kind { size: number; name: string }

function outer(p: any, parent: number | null): string {
  const head = parent === null ? "" : "<part 0=" + parent + ">" + "<part 1=" + parent + ">";
  return head + (p as Kind).name;
}
const given: any = process.argv.length > 9 ? JSON.parse(process.argv[9]) : { size: 1, name: "k" };
let length = 0;
for (let turn = 0; turn < 5000; turn++) length += outer(given, null).length;
console.log(length);
