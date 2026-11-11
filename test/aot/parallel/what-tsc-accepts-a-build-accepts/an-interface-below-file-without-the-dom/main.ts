// Without the DOM's library only the types of Bun say that a File is a Blob, and the compiler reads it on the line of the global `File`. An interface of the program
// below File goes to a position that asks for `name` alone, and the function has one body. Where that line does not name Blob, the function gets a guard and a
// second body: 6 units, not 4.
// STATISTIC: UnitsCompiled <= 5
export {};
interface Named {
  name: string;
}
interface Upload extends File {
  note?: string;
}
function nameOf(x: Named): string {
  return x.name;
}
function lengthOfName(x: Named): number {
  let length = 0;
  for (let turn = 0; turn < 100; turn++) length += x.name.length;
  return length;
}
const upload: Upload = new File(["ab"], "a.txt");
const plain: Named = { name: "plain" };
console.log(nameOf(upload), nameOf(plain), lengthOfName(upload), lengthOfName(plain));
