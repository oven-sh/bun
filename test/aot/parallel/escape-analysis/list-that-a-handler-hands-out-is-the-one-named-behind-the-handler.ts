// a handler hands out a list that was made in front of the try, and the code behind the handler pushes onto it
let last: number[] | undefined;
function keep(list: number[]) { last = list; }
function subject(a: number, b: number, risky: () => void) { const list = [a, b]; list[0] = a + 1; try { risky(); } catch { keep(list); } list.push(9); return list; }
function fails() { throw new Error("no"); }
function passes() { }
function deed(a: number, risky: () => void) { last = undefined; const list = subject(a, a + 1, risky); return String(last === list) + " " + (last ? last.join() : "none") + " " + list.join(); }
console.log(deed(1, passes), deed(1, fails));
let text = "";
for (let i = 0; i < 300; i++) text = deed(i, i % 2 ? fails : passes);
console.log(text);
console.log(deed(7, fails), deed(7, passes));
