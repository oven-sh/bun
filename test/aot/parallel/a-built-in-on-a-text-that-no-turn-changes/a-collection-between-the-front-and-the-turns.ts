const list: string[] = []; for (let i = 0; i < 40; i++) list.push("name" + (i % 7));
function run(q: string): number { let n = 0; for (let i = 0; i < list.length; i++) { if (list[i] === q.toLowerCase()) n++; if (i % 13 === 5) Bun.gc(true); } return n; }
function churn(q: string): number { let n = 0; const kept: string[] = []; for (let i = 0; i < list.length; i++) { if (list[i] === q.slice(1).trim()) n++; kept.push("x".repeat(i) + i); } return n + kept.length; }
(globalThis as any).kept = [run, churn];
console.log(run("NAME3"), run("Name5"), churn("x name1 "), churn("-name6"));
