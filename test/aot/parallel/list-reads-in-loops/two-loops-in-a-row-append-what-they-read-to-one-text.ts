// two loops in a row read a list and append to one text, under every pair of bounds
function commasThenSemicolons(list: number[]): string { let text = ""; for (let i = 0; i <= list.length; i++) text += list[i] + ","; for (let i = -2; i < list.length; i++) text += list[i] + ";"; return text; }
function twiceTheSame(list: number[]): string { let text = ""; for (let i = 0; i < list.length; i++) text += list[i] + ","; for (let i = 0; i < list.length; i++) text += list[i] + ";"; return text; }
function upAndDown(list: string[]): string { let text = ""; for (let i = 0; i < list.length; i++) text += list[i]; for (let i = list.length - 1; i >= 0; i--) text += list[i]; return text; }
function oneInTheOther(list: number[]): string { let text = ""; for (let i = 0; i < list.length; i++) { for (let j = 0; j <= i; j++) text += list[j] + ","; text += ";"; } return text; }
function countsBetween(list: number[]): string { let text = ""; let n = 0; for (let i = 0; i < list.length; i++) text += list[i] + ","; for (let i = 0; i < list.length; i++) n += list[i]; for (let i = 0; i < list.length; i++) text += list[i] + n; return text; }
console.log(commasThenSemicolons([1, 2, 3, 4]), commasThenSemicolons([0.5, 1.5]), commasThenSemicolons([]));
console.log(twiceTheSame([1, 2, 3, 4]), twiceTheSame([0.5, 1.5]), twiceTheSame([]), twiceTheSame([1, , 3] as number[]));
console.log(upAndDown(["a", "b", "c"]), upAndDown([]), upAndDown(["x"]));
console.log(oneInTheOther([1, 2, 3]), oneInTheOther([]));
console.log(countsBetween([1, 2, 3]), countsBetween([0.5]), countsBetween([]));
