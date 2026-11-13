const j = JSON.parse(require("fs").readFileSync("search.json", "utf8"));
if (j.errors) console.log("ERRORS", JSON.stringify(j.errors).slice(0, 500));
const d = j.data;
for (const k of Object.keys(d)) {
  if (!k.startsWith("s")) continue;
  console.log(`\n== ${k}: ${d[k].issueCount} results`);
  for (const n of d[k].nodes) {
    if (!n.number) continue;
    console.log(`  #${n.number} [${n.__typename === "PullRequest" ? "PR" : "issue"} ${n.state}${n.isDraft ? " draft" : ""}${n.mergedAt ? " merged" : ""}] ${n.author?.login}(${n.authorAssociation}) ${n.createdAt.slice(0, 10)} c=${n.comments.totalCount}${n.reactions ? " r=" + n.reactions.totalCount : ""}${n.additions !== undefined ? ` +${n.additions}-${n.deletions}` : ""} | ${n.title.slice(0, 130)}`);
  }
}
