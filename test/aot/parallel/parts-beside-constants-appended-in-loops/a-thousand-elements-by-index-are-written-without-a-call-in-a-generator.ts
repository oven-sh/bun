// the same in a generator, whose builder lies in the heap
// COUNT: operation:operationAOTIntToString <= 20
// COUNT: operation:operationAOTStringBuilderAppend <= 20
function* shape(list: number[]): Generator<string> { let line = ""; for (let i = 0; i < list.length; i++) line += list[i] + ","; yield line; }
(globalThis as any).kept = shape;
const list: number[] = []; for (let i = 0; i < 1000; i++) list.push(i);
for (const text of shape(list)) console.log(text.length);
for (const text of shape([1, , 3, 0.5, -0, 2 ** 31, -1, NaN] as number[])) console.log(text);
