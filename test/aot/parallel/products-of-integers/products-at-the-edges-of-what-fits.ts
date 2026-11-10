const say = (name: string, x: number) => console.log(name, Object.is(x, -0) ? "-0" : String(x));
function below(a: number, b: number): number { return (a & 0x7fffffff) * (b & 0x7fffffff); }
function over(a: number, b: number): number { return (a >>> 0) * (b >>> 0); }
function half(a: number, b: number): number { return (a >>> 0) * (b & 0x7fffffff); }
function down(a: number, b: number): number { return -(a >>> 0) * ((b & 0x7fffffff) + 1); }
const edges = [0, 1, 2, 3, 255, 65535, 65536, 94906265, 94906266, 94906267, 134217729, 134217730, 1073741823, 1073741824, 2147483646, 2147483647, 2147483648, 2147483649, 4294967294, 4294967295, -1, -2, -2147483648];
for (const a of edges) {
  for (const b of edges) {
    say("below " + a + " " + b, below(a, b));
    say("over " + a + " " + b, over(a, b));
    say("half " + a + " " + b, half(a, b));
    say("down " + a + " " + b, down(a, b));
  }
}
