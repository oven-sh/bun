const thunks: Array<() => any> = [];
function link(thunk: () => any) { return (_t: any, _k: string) => { thunks.push(thunk); }; }
for (let round = 0; round < 3; round++) {
  const swap = (_original: any): any => class Replacement { static tag = "replacement " + round; };
  @swap
  class Branch {
    static tag = "original " + round;
    @link(() => Branch) parent: any;
  }
}
console.log(thunks.map((thunk) => thunk().tag).join(" . "));
