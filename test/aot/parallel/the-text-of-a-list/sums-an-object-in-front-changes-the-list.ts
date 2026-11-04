// One list a program, one road a program: the text of a list is asked for by list.toString(), String(list), a template, a sum, and as an element of another list. Made by staging/the-text-of-a-list-1/make-family-of-lists.py.
const said: string[] = [];
function sum(left: any, right: any): string { return left + right; }
(globalThis as any).kept = sum;
const list: any[] = [1, 2]; const front = { toString() { list.push("late"); return "front:"; } }; said.push(sum(front, list), sum(front, list));
console.log(said.map(text => JSON.stringify(text)).join(" | "));
