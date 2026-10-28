// `[...numbers]`: the literal keeps its elements the way the array that is spread into it does, so it is born as a copy. What is left over goes to a stub and not to the run time.
// CALLS- copy LanguageOperation
// CALLS- copyBoth LanguageOperation
const kept: number[][] = [];
function copy(numbers: number[]): number[] { const made = [...numbers]; kept.push(made); return made; }
function copyBoth(first: number[], second: number[]): number[] { const made = [...first, ...second]; kept.push(made); return made; }
function copyWords(words: string[]): string[] { return [...words]; }
function copyAround(numbers: number[]): number[] { return [0.5, ...numbers, 9]; }
function show(list: unknown[]): string { return list.length + ":" + list.map(one => one === undefined ? "u" : String(one)).join(); }
const doubles: number[] = [1.5, 2.5, 3.5];
const integers: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const empty: number[] = [];
const holes: number[] = [1, 2, 3]; delete (holes as unknown as Record<number, number>)[1];
const long: number[] = []; for (let i = 0; i < 200; i++) long.push(i / 2);
const grown: number[] = []; for (let i = 0; i < 5; i++) grown.push(i);
const mixed = [1, "two", 3] as unknown as number[];
const special: number[] = [NaN, -0, Infinity, 2 ** 31, -(2 ** 31) - 1];
for (const list of [doubles, integers, empty, holes, grown, mixed, special]) console.log(show(copy(list)), copy(list) !== list, 1 in copy(list));
console.log(show(copy(long)).length, copy(long)[199], Object.is(copy(special)[1], -0));
console.log(show(copyBoth(doubles, integers)), show(copyBoth(empty, holes)), show(copyBoth(mixed, doubles)));
console.log(show(copyWords(["a", "b"])), show(copyAround(doubles)), show(copyAround(empty)), show(copyAround(holes)));
const made = copy(doubles); made.push(7); made[0] = 0; (made as unknown[]).push("text");
console.log(show(made), show(doubles));
class Many extends Array<number> { *[Symbol.iterator](): ArrayIterator<number> { yield 42; } }
const many = new Many(); many.push(1, 2);
console.log(show(copy(many)), Array.isArray(copy(many)), copy(many) instanceof Many);
let garbage: number[][] = [];
for (let round = 0; round < 50; round++) { garbage = []; for (let i = 0; i < 400; i++) garbage.push(copy(integers)); kept.length = 0; }
console.log(show(garbage[399]), [copy, copyBoth, copyWords, copyAround].map(one => one.name).join());
