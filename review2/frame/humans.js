const d = JSON.parse(require("fs").readFileSync("linked.json", "utf8")).data.repository;
const bots = /^(claude|coderabbitai|github-actions|copilot|robobun|autofix-ci)/i;
for (const k of Object.keys(d)) {
  const n = d[k];
  console.log("=".repeat(90) + `\n#${n.number} ${n.title} [${n.state}${n.isDraft ? " draft" : ""}]`);
  const items = [];
  for (const c of n.comments.nodes) items.push({ t: c.createdAt, who: c.author?.login, assoc: c.authorAssociation, kind: "comment", body: c.body });
  for (const r of n.reviews?.nodes ?? []) items.push({ t: r.submittedAt, who: r.author?.login, assoc: r.authorAssociation, kind: "review:" + r.state, body: r.body });
  for (const th of n.reviewThreads?.nodes ?? []) for (const c of th.comments.nodes) items.push({ t: c.createdAt, who: c.author?.login, assoc: c.authorAssociation, kind: "thread:" + th.path + (th.isResolved ? " (resolved)" : ""), body: c.body });
  const authors = {};
  for (const i of items) authors[`${i.who} (${i.assoc})`] = (authors[`${i.who} (${i.assoc})`] || 0) + 1;
  console.log("participants:", JSON.stringify(authors));
  for (const i of items.sort((a, b) => (a.t < b.t ? -1 : 1))) {
    if (bots.test(i.who || "")) continue;
    console.log(`\n[${i.t}] ${i.who} (${i.assoc}) ${i.kind}:\n${(i.body || "").slice(0, 2500)}`);
  }
}
