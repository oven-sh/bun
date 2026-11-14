function turn(n: number): number { const kept: number[] = []; for (let i = 0; i < n; i++) kept.push(i | 0); let turns = 0; for (let i = 0; i < kept.length; i++) { const twice = kept[i]! * 2; turns++; } return turns; }
function total(n: number): number { const kept: number[] = []; for (let i = 0; i < n; i++) kept.push(i | 0); let all = 0; for (let i = 0; i < kept.length; i++) all += kept[i]!; return all; }
console.log(turn(process.argv.length + 40), total(process.argv.length + 40));
