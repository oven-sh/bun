// One list a program, one road a program: the text of a list is asked for by list.toString(), String(list), a template, a sum, and as an element of another list. Made by staging/the-text-of-a-list-1/make-family-of-lists.py.
const said: string[] = [];
function sum(left: any, right: any): string { return left + right; }
(globalThis as any).kept = sum;
said.push(sum([1], 2), sum(2, [1]), sum([], 5), sum([7], [8]), sum([1.5], null), sum(undefined, [,]));
console.log(said.map(text => JSON.stringify(text)).join(" | "));
