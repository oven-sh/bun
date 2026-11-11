const list: string[] = JSON.parse('["ab","cd","ab","ef","cd"]');
function run(q: string): string { let s = ""; for (let i = 0; i < list.length; i++) { s += (list[i] === q.toLowerCase() ? "y" : "n"); if (i === 1) q = "CD"; if (i === 3) q = q + ""; } return s; }
function other(q: string): string { let s = ""; for (let i = 0; i < list.length; i++) { const low = q.toLowerCase(); s += low; q = low + "X"; } return s; }
(globalThis as any).kept = [run, other];
console.log(run("AB"), run("EF"), other("Q"));
