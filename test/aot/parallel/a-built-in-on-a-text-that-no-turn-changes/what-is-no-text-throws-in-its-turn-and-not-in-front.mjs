const log = [];
function run(q, n) { for (let i = 0; i < n; i++) { log.push("turn" + i); log.push(q.toLowerCase()); } return log.length; }
globalThis.kept = run;
for (const q of JSON.parse('["AB", null, 7, "Cd"]')) { try { run(q, 2); } catch (e) { log.push(e.constructor.name); } try { run(q, 0); log.push("none"); } catch (e) { log.push("THREW WITH NO TURN"); } }
console.log(log.join());
