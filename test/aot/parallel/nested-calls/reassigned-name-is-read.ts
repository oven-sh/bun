function outer(swap: boolean): number {
  if (swap) (f as unknown) = function () { return 2; };
  return f();
  function f(): number { return 1; }
}
console.log(outer(false), outer(true));
