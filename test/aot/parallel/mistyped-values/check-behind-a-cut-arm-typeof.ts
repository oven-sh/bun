// A parameter is checked where it is used, behind an arm that every call leaves out. Typing the split body cuts that arm, and the values that stay get other numbers: the check is asked for under its new one.
interface Kind { size: number; name: string }

function outer(p: any, parent: number | null): string {
  let head = ""; if (typeof parent === "number") head = "<part 0=" + parent + ">" + "<part 1=" + parent + ">" + "<part 2=" + parent + ">" + "<part 3=" + parent + ">" + "<part 4=" + parent + ">" + "<part 5=" + parent + ">" + "<part 6=" + parent + ">" + "<part 7=" + parent + ">" + "<part 8=" + parent + ">" + "<part 9=" + parent + ">" + "<part 10=" + parent + ">" + "<part 11=" + parent + ">";
  return head + (p as Kind).name;
}
const given: any = process.argv.length > 9 ? JSON.parse(process.argv[9]) : { size: 1, name: "k" };
let length = 0;
for (let turn = 0; turn < 5000; turn++) length += outer(given, null).length;
console.log(length);
