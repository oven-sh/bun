namespace Tools {
  export function twice(x: number): number { return x * 2; }
  export function viaName(x: number): number { return twice(x) + hidden(x); }
  function hidden(x: number): number { return x + 1; }
  export function unused(): string { return "unused"; }
  export namespace Deep {
    export function one(): number { return 1; }
    export function two(): number { return one() + 1; }
  }
}
const before = Tools.viaName(3), deepBefore = Tools.Deep.two();
(Tools as { twice: (x: number) => number }).twice = x => x * 100;
(Tools.Deep as { one: () => number }).one = () => 10;
console.log(before, Tools.viaName(3), Object.keys(Tools).join(","), Tools.unused(), deepBefore, Tools.Deep.two());
