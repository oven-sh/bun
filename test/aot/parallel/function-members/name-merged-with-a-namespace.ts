function f(n: number) {
  return n + 1;
}
f.custom = 1;
declare namespace f {
  export let later: number;
}
console.log(f.custom, f(1), Object.keys(f));
