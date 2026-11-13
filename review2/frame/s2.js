const d = JSON.parse(require("fs").readFileSync("search.json", "utf8")).data.repository;
const bots = /^(claude|coderabbitai|github-actions|copilot|autofix-ci)/i;
for (const k of Object.keys(d)) {
  const n = d[k];
  console.log("=".repeat(100));
  console.log(`#${n.number} [${n.__typename}] ${n.title}`);
  console.log(`state=${n.state} draft=${n.isDraft ?? "-"} author=${n.author?.login} (${n.authorAssociation}) created=${n.createdAt} closed=${n.closedAt} merged=${n.mergedAt ?? "-"} ${n.additions !== undefined ? `+${n.additions}-${n.deletions} files=${n.changedFiles}` : ""}`);
  console.log(`labels=${n.labels.nodes.map(l => l.name).join(", ")} reactions=${n.reactions.totalCount} comments=${n.comments.totalCount}`);
  console.log("--- body (first 1500) ---\n" + n.body.slice(0, 1500));
  const items = [];
  for (const c of n.comments.nodes) items.push({ t: c.createdAt, who: c.author?.login, assoc: c.authorAssociation, kind: "comment", body: c.body });
  for (const r of n.reviews?.nodes ?? []) items.push({ t: r.submittedAt, who: r.author?.login, assoc: r.authorAssociation, kind: "review:" + r.state, body: r.body });
  const authors = {};
  for (const i of items) authors[`${i.who} (${i.assoc})`] = (authors[`${i.who} (${i.assoc})`] || 0) + 1;
  console.log("participants:", JSON.stringify(authors));
  for (const i of items.sort((a, b) => (a.t < b.t ? -1 : 1))) {
    if (bots.test(i.who || "") || i.who === "robobun") continue;
    console.log(`\n[${i.t}] ${i.who} (${i.assoc}) ${i.kind}:\n${(i.body || "").slice(0, 1200)}`);
  }
}
