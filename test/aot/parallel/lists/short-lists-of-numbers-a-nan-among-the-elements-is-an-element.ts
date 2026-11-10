function ratio(top: number, bottom: number): number { return top / bottom; }
function make(a: number, b: number): number[] { return [ratio(a, b), a + 0.5, ratio(b, b)]; }
for (let turn = 0; turn < 3; turn++) {
    const list = make(0, turn === 1 ? 2 : 0);
    console.log(turn, list.length, list[0], list[1], list[2], 0 in list, 2 in list, list.includes(NaN), list.indexOf(NaN), JSON.stringify(list), Object.keys(list).join());
    let seen = 0; list.forEach(() => { seen++; }); console.log(seen, String(list), list.map(x => x !== x).join());
}
