// `line += list[i] + ","`: list[i] is written undefined or a number: no string is made of the element, and no call writes it: the code of the part asks the tag
// COUNT: operation:operationAOTIntToString <= 20
// COUNT: operation:operationAOTStackStringBuilderAppend <= 20
function shape(list: number[]): string { let line = ""; for (let i = 0; i < list.length; i++) line += list[i] + ","; return line; }
(globalThis as any).kept = shape;
const list: number[] = []; for (let i = 0; i < 1000; i++) list.push(i);
console.log(shape(list).length, shape([1, , 3] as number[]), shape([0.5, -0, 2 ** 31, -1, NaN]));
