function link(list: Array<() => any>, thunk: () => any) { return (_t: any, _k: string) => { list.push(thunk); }; }
function build(round: number) {
  const thunks: Array<() => any> = [];
  function swap(_original: any): any { return class Replacement { static tag = "replacement " + round; }; }
  @swap
  class Branch {
    static tag = "original " + round;
    @link(thunks, () => Branch) parent: any;
    grow(@link(thunks, () => Branch) by: number) { return by; }
  }
  return thunks;
}
let right = 0;
let last = "";
for (let round = 0; round < 300; round++) {
  const thunks = build(round);
  for (const thunk of thunks) { last = thunk().tag; if (last === "replacement " + round) right++; }
}
console.log(right, last);
