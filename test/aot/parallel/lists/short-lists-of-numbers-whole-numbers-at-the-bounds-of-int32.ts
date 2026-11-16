function pair(i: number): [number, number] { return [i | 0, (i | 0) + 1]; }
function shifted(i: number): [number, number] { return [i >>> 0, i >> 1]; }
for (const i of [0, -1, 2147483647, -2147483648, 4294967295]) {
    const a = pair(i), b = shifted(i);
    console.log(a[0], a[1], b[0], b[1], a[0] + a[1], JSON.stringify([a, b]));
}
