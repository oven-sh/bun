function negate(x: number): number { return x * -1; }
function pair(x: number): [number, number] { return [negate(x), x + 1]; }
function fractions(x: number): [number, number] { return [negate(x), x + 0.5]; }
for (const x of [0, 1, 2]) {
    const whole = pair(x), broken = fractions(x);
    console.log(Object.is(whole[0], -0), Object.is(broken[0], -0), 1 / whole[0], 1 / broken[0], whole[1], broken[1]);
}
