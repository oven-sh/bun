class Tag { n = 1; m = 2; }
const unseen = (x: any): any => [x][JSON.parse("0")];
const shown: any = unseen(5);
const text: any = unseen("text");
const opened = (0, eval)("1 + 1");
console.log(opened);
function main() {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  function probe(tag: Tag, value: any): any {
    let work = 0;
    for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0;
    let smaller: boolean | null = tag.n < work;
    smaller = null;
    const out = shown;
    if (smaller !== null) return 0;
    return out + (typeof value === "number" ? "n" : "o");
  }
  const real = new Tag();
  let last: any = work;
  for (let turn = 0; turn < 300; turn++) last = probe(real, unseen("text"));
  console.log(String(last), String(probe(real, unseen(7))));
  const liar = unseen({ n: 1, m: 2 });
  console.log(String(probe(liar, unseen("text"))), String(probe(liar, unseen(7))));
  let slow = "";
  for (let turn = 0; turn < 300; turn++) slow = String(probe(liar, unseen(turn & 1 ? "text" : turn)));
  console.log(slow);
}
main();
export {};
