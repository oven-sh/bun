const say = (name: string, x: number) => console.log(name, Object.is(x, -0) ? "-0" : String(x), 1 / x);
function signed(a: number, b: number): number { return (a | 0) * (b | 0); }
function left(a: number, b: number): number { return (a & 255) * (b | 0); }
function right(a: number, b: number): number { return (a | 0) * (b & 255); }
function beside(a: number, b: number): number { return ((a & 255) + 1) * (b | 0); }
function under(a: number, b: number): number { return (-(a & 255) - 1) * (b & 255); }
function counted(to: number, by: number): number { let last = 1; for (let i = 0; i < to; i++) last = i * (by | 0); return last; }
const edges = [0, 1, -1, 5, -5, 255, 256, -256, 2147483647, -2147483648];
for (const a of edges) {
  for (const b of edges) {
    say("signed " + a + " " + b, signed(a, b));
    say("left " + a + " " + b, left(a, b));
    say("right " + a + " " + b, right(a, b));
    say("beside " + a + " " + b, beside(a, b));
    say("under " + a + " " + b, under(a, b));
  }
}
say("counted", counted(1, -3));
say("counted", counted(2, -3));
say("counted", counted(1, 3));
