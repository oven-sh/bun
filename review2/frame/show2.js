const d = JSON.parse(require("fs").readFileSync("linked.json", "utf8")).data.repository;
const which = process.argv[2]; const maxBody = +process.argv[3] || 3000; const maxC = +process.argv[4] || 1500;
const who = new RegExp(process.argv[5] || "robobun|Jarred|alii", "i");
const n = d["n" + which];
console.log(`#${n.number} ${n.title} [${n.state}]\n--- BODY ---\n${n.body.slice(0, maxBody)}${n.body.length > maxBody ? `\n...[+${n.body.length - maxBody}c]` : ""}`);
console.log("--- COMMENTS (filtered) ---");
for (const c of n.comments.nodes) if (who.test(c.author?.login || "") && !/generated-comment|bunx bun-pr/.test(c.body)) console.log(`\n[${c.createdAt}] ${c.author?.login} (${c.authorAssociation}):\n${c.body.slice(0, maxC)}${c.body.length > maxC ? `\n...[+${c.body.length - maxC}c]` : ""}`);
