function run(from: number, to: number): number { let h = 7; for (let i = from | 0; i <= (to | 0); i += 4) h = (h * 31 + i) | 0; return h; }
function all(from: number): void { let said = ""; for (let turns = -2; turns < 40; turns++) said += run(from, from + 1 * turns) + " "; console.log(from, said); }
all(0); all(1); all(-1); all(5); all(-37); all(1000); all(2147483587); all(-2147483648);
console.log(run(-2147483648, -2147483645), run(-2147483648, -2147483648), run(2147483447, 2147483627));
console.log(run(0, 3000000), run(-1500000, 1500007));
