const first: number[] = [1, 2, 3];
const second: number[] = [4, 5, 6];
function pick(which: boolean): number[] { return which ? first : second; }
Object.freeze(pick(true));
function both(wanted: number): string { return [first.includes(wanted), second.includes(wanted), first.indexOf(wanted), second.indexOf(wanted), first.join(""), second.join("")].join(); }
let all = "";
for (let round = 1; round < 6; round += 2) all += both(round) + ";";
second.push(7);
try { first.push(8); all += "pushed"; } catch (error) { all += (error as Error).constructor.name; }
console.log(all, first.length, second.length);
