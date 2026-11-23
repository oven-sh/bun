class Tag { n = 1; m = 2; }
const unseen = (x: any): any => [x][JSON.parse("0")];
function main() {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  function kindOf(tag: Tag, value: any): string {
    let work = 0;
    for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0;
    let smaller: boolean | null = tag.n < work;
    smaller = null;
    if (typeof value === "number") return "number";
    return smaller === null ? "other" : "none";
  }
  const real = new Tag();
  let last = "";
  for (let turn = 0; turn < 300; turn++) last = kindOf(real, unseen("text"));
  console.log(last, kindOf(real, unseen(7)), work);
  const liar = unseen({ n: 1, m: 2 });
  console.log(kindOf(liar, unseen("text")), kindOf(liar, unseen(7)));
}
main();
export {};
