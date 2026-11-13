const d = JSON.parse(require("fs").readFileSync("linked.json", "utf8")).data.repository;
const which = process.argv[2];
const maxBody = +process.argv[3] || 3000;
const maxC = +process.argv[4] || 1500;
const n = d["n" + which];
console.log(`#${n.number} ${n.title}\n--- BODY ---\n${n.body.slice(0, maxBody)}${n.body.length > maxBody ? `\n...[+${n.body.length - maxBody}c]` : ""}`);
console.log("--- COMMENTS ---");
for (const c of n.comments.nodes) console.log(`\n[${c.createdAt}] ${c.author?.login} (${c.authorAssociation}):\n${c.body.slice(0, maxC)}${c.body.length > maxC ? `\n...[+${c.body.length - maxC}c]` : ""}`);
if (n.reviews) {
  console.log("--- REVIEWS (by author/state) ---");
  const by = {};
  for (const r of n.reviews.nodes) { const k = `${r.author?.login} (${r.authorAssociation}) ${r.state}`; by[k] = (by[k] || 0) + 1; }
  console.log(by);
  for (const r of n.reviews.nodes) if (r.body && !/^(claude|coderabbitai|github-actions|copilot)/i.test(r.author?.login || "")) console.log(`\n[review ${r.submittedAt}] ${r.author?.login} (${r.authorAssociation}) ${r.state}:\n${r.body.slice(0, maxC)}`);
}
