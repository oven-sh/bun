// in a loop and as an argument
function count(flags: number[], names: (string | undefined)[]): number { let n = 0; for (let i = 0; i < flags.length; i++) n += Number(!!(flags[i] & 2 && names[i] || flags[i] & 4)); return n; }
console.log(count([0, 2, 2, 4, 6, 1], ["a", "", "b", undefined, "c", "d"]));
