const seed = process.argv.length;
const total = (list: unknown[]): number => { let sum = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "number") sum += x; } return sum; };
const below = (list: unknown[], bound: number): number => { let n = 0; for (let i = 0; i < list.length; i++) if ((list[i] as number) < bound) n++; return n; };
const scaled = (rows: unknown[][], by: number): number => { let sum = 0; for (const row of rows) for (let j = 0; j < row.length; j++) sum += (row[j] as number) * by; return sum; };
const kept: unknown[] = []; const keep = (list: unknown[]): void => { for (let i = 0; i < list.length; i++) kept.push(list[i]); };
const fractions: unknown[] = []; for (let i = 0; i < 9; i++) fractions.push(seed / 3 + i + 0.5);
const whole: unknown[] = []; for (let i = 0; i < 9; i++) whole.push(seed + i);
const holes: unknown[] = [0.5, , 1.5, , seed / 7]; const odd: unknown[] = [0.5, "two", null, undefined, { valueOf: () => 4 }, NaN, -0, 1e308, 2n ** 2n === 4n];
const turned: unknown[] = [seed + 0.5, seed + 1.5]; const lists = [fractions, whole, holes, odd, turned, []];
for (const reader of [total, (l: unknown[]) => below(l, seed + 2), (l: unknown[]) => scaled([l, fractions], 0.5)]) {
    for (let turn = 0; turn < 300; turn++) {
        if (turn === 150) turned[1] = "text";
        for (const list of lists) { let answer: unknown; try { answer = reader(list); } catch (error) { answer = (error as Error).constructor.name; } if (turn === 149 || turn === 299) console.log(answer); }
        if (turn === 299) turned[1] = seed + 1.5;
    }
}
keep(fractions); keep(holes); keep(odd.slice(0, 4)); console.log(kept.length, JSON.stringify(kept.slice(7, 16)), Object.is((odd as number[])[6], -0));
