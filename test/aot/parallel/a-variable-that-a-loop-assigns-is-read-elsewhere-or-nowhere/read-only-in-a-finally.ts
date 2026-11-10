const n = (value: number) => Number(process.argv[8] ?? value);
function run(limit: number) { let step = "start"; const said: string[] = []; try { for (let i = 0; i < limit; i++) { step = "turn " + i; if (i === 2) throw new Error("stop"); } step = "end"; } catch { said.push("caught"); } finally { said.push(step); } return said.join(); }
console.log(run(n(5)), run(n(2)), run(n(0)));
