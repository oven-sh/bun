const d = JSON.parse(require("fs").readFileSync("linked.json", "utf8")).data.repository;
for (const k of Object.keys(d)) {
  const n = d[k];
  if (!n) { console.log(k, "null"); continue; }
  console.log("=".repeat(100));
  console.log(`#${n.number} [${n.__typename}] ${n.title}`);
  console.log(`state=${n.state} draft=${n.isDraft ?? "-"} author=${n.author?.login} (${n.authorAssociation}) created=${n.createdAt} closed=${n.closedAt} merged=${n.mergedAt ?? "-"}`);
  if (n.headRefName) console.log(`head=${n.headRefName}@${n.headRefOid?.slice(0, 11)} base=${n.baseRefName} +${n.additions} -${n.deletions} files=${n.changedFiles}`);
  console.log(`labels=${n.labels.nodes.map(l => l.name).join(", ")} reactions=${n.reactions.totalCount} comments=${n.comments.totalCount} reviews=${n.reviews?.totalCount ?? "-"} threads=${n.reviewThreads?.totalCount ?? "-"}`);
  console.log(`body length=${n.body.length}`);
}
