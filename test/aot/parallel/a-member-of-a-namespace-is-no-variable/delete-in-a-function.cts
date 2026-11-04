namespace N {
  export var x = 1;
  // @ts-ignore
  export function drop() { return delete x; }
  export function read() { return x; }
}
console.log(N.read(), N.drop(), "x" in N, N.read(), N.drop());
