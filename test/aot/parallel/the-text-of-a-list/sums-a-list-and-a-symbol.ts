// One list a program, one road a program: the text of a list is asked for by list.toString(), String(list), a template, a sum, and as an element of another list. Made by staging/the-text-of-a-list-1/make-family-of-lists.py.
const said: string[] = [];
function sum(left: any, right: any): string { return left + right; }
(globalThis as any).kept = sum;
try { sum([1], Symbol("s")); } catch (error) { said.push((error as Error).constructor.name); } try { sum(Symbol("s"), [{ toString() { said.push("asked"); return "x"; } }]); } catch (error) { said.push((error as Error).constructor.name); }
console.log(said.map(text => JSON.stringify(text)).join(" | "));
