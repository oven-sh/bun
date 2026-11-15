function asNumber(list: number[]): number { return Number(list) + Math.max(list as unknown as number, 1) + parseInt(list as unknown as string, 10); }
let sum = 0;
for (let round = 0; round < 5; round++) sum += asNumber([round * 3]);
console.log(sum, asNumber([]), asNumber([1, 2]));
