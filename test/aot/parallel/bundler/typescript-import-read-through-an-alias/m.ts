console.log("load m");
export namespace inner {
  export function f(x: number) {
    return x + 1;
  }
}
export function g() {
  return "g";
}
