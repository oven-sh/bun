// `target` is stored as a function value that nothing reads, so the entry made for calls through that value loses its body. `free` had been inlined into it, and the compiler still looked at its reads of a free name.
declare const someFreeName: number | undefined;
function free(): number {
  return typeof someFreeName === "undefined" ? 0.5 : someFreeName;
}
function target(x: number): number {
  return free() + x;
}
export const unused: (x: number) => number = target;
console.log(target(1.5));
