const j = JSON.parse(require("fs").readFileSync("search3.json", "utf8"));
if (j.errors) console.log("ERRORS", JSON.stringify(j.errors).slice(0, 800));
const d = j.data;
for (const k of Object.keys(d)) {
  if (!k.startsWith("s")) continue;
  console.log(`\n== ${k}: ${d[k].issueCount} results`);
  for (const n of d[k].nodes) {
    if (!n.number) continue;
    const rv = n.reviews ? " reviews=" + n.reviews.nodes.map(r => `${r.author?.login}:${r.state}`).join(",") : "";
    console.log(`  #${n.number} [${n.__typename === "PullRequest" ? "PR" : "issue"} ${n.state}] ${n.author?.login}(${n.authorAssociation}) ${n.createdAt.slice(0, 10)}${n.mergedAt ? " merged " + n.mergedAt.slice(0, 10) + " by " + n.mergedBy?.login : ""} c=${n.comments.totalCount}${n.reactions ? " r=" + n.reactions.totalCount : ""}${n.additions !== undefined ? ` +${n.additions}-${n.deletions}` : ""}${rv} | ${n.title.slice(0, 120)}`);
  }
}
const bots = /^(claude|coderabbitai|github-actions|copilot|autofix-ci)/i;
const r = d.repository;
for (const k of Object.keys(r)) {
  const n = r[k];
  console.log("\n" + "=".repeat(100));
  console.log(`#${n.number} ${n.title}`);
  console.log(`state=${n.state} draft=${n.isDraft} author=${n.author?.login} created=${n.createdAt.slice(0,10)} merged=${n.mergedAt ? n.mergedAt.slice(0,10) + " by " + n.mergedBy?.login : "-"} +${n.additions}-${n.deletions} files=${n.changedFiles}`);
  console.log("--- body (first 1300) ---\n" + n.body.slice(0, 1300));
  const items = [];
  for (const c of n.comments.nodes) items.push({ t: c.createdAt, who: c.author?.login, assoc: c.authorAssociation, kind: "comment", body: c.body });
  for (const rr of n.reviews?.nodes ?? []) items.push({ t: rr.submittedAt, who: rr.author?.login, assoc: rr.authorAssociation, kind: "review:" + rr.state, body: rr.body });
  const authors = {};
  for (const i of items) authors[`${i.who} (${i.assoc})`] = (authors[`${i.who} (${i.assoc})`] || 0) + 1;
  console.log("participants:", JSON.stringify(authors));
  for (const i of items.sort((a, b) => (a.t < b.t ? -1 : 1))) {
    if (bots.test(i.who || "") || i.who === "robobun") continue;
    console.log(`\n[${i.t}] ${i.who} (${i.assoc}) ${i.kind}:\n${(i.body || "").slice(0, 900)}`);
  }
}
