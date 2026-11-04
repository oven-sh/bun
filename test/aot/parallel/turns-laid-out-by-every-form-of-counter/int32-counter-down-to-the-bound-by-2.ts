function run(from: number, to: number): number { let h = 7; for (let i = from | 0; i >= (to | 0); i -= 2) h = (h * 31 + i) | 0; return h; }
function all(from: number): void { let said = ""; for (let turns = -2; turns < 40; turns++) said += run(from, from + -1 * turns) + " "; console.log(from, said); }
all(0); all(1); all(-1); all(5); all(-37); all(1000); all(-2147483588); all(2147483647);
console.log(run(2147483647, 2147483644), run(2147483647, 2147483647), run(-2147483448, -2147483628));
console.log(run(3000000, 0), run(1500000, -1500007));
