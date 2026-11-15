class Tag { n = 1; m = 2; }
const unseen = (x: any): any => [x][JSON.parse("0")];
const shown: any = unseen(5);
function main() {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  function weigh(tag: Tag): any {
    let work = 0;
    for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0;
    let smaller: boolean | null = tag.n < work;
    smaller = null;
    const out = shown;
    if (smaller !== null) return 0;
    return out;
  }
  const real = new Tag();
  let last: any = work;
  for (let turn = 0; turn < 300; turn++) last = weigh(real);
  console.log(last, weigh(real));
  const liar = unseen({ n: 1, m: 2 });
  console.log(weigh(liar));
}
main();
export {};
