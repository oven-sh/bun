const numbers: number[] = JSON.parse("[0,1,2,3,4,5,8,100,70000]");
function drain(list: number[], at: number): string { let total = 0, turns = 0; for (let i = 0; i < list.length; i++) { total += list[i]!; turns++; if (i === at) list.length = 0; } return total + ":" + turns + ":" + list.length; }
function refill(list: number[], rounds: number): number { let total = 0; for (let round = 0; round < rounds; round++) { list.length = 0; for (let i = 0; i <= round; i++) list.push(i + 0.5); for (let i = 0; i < list.length; i++) total += list[i]!; } return total; }
console.log(drain([1.5, 2.5, 3.5, 4.5], numbers[1]!), drain([1, 2, 3, 4], numbers[3]!), drain([1, 2, 3, 4], numbers[7]!), refill([], numbers[5]!), refill([9, 9, 9, 9, 9, 9, 9, 9, 9], numbers[4]!));
