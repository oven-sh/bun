import { issueListUrl, type IssueFilters, type IssueSort } from "../filters";
import { formatCount, formatNumber, timeTag } from "../format";
import type { IssueSummary, LabelCount, Project, StateCounts } from "../types";
import { escape, labelChip, priorityNames, userLink } from "./layout";

const sorts: [IssueSort, string][] = [
  ["updated", "Recently updated"],
  ["created", "Newest"],
  ["comments", "Most commented"],
];

function issueItem(project: Project, issue: IssueSummary): string {
  return `<li class="issue ${issue.state} priority-${priorityNames[issue.priority]}">
<a class="title" href="/p/${project.slug}/issues/${issue.number}">${escape(issue.title)}</a> ${issue.labels.map(labelChip).join(" ")}
<div class="meta">#${issue.number} opened ${timeTag(issue.createdAt)} by ${userLink(issue.author)}${
    issue.assignee ? `, assigned to ${userLink(issue.assignee)}` : ""
  }, updated ${timeTag(issue.updatedAt)}${issue.commentCount > 0 ? `, ${formatCount(issue.commentCount, "comment")}` : ""}</div>
</li>`;
}

/** 1 2 3 .. 9 [10] 11 .. 40: the first, the last, and two on either side of the current page. */
export function pagination(page: number, pages: number, urlOfPage: (page: number) => string): string {
  if (pages <= 1) return "";
  const parts: string[] = [];
  if (page > 1) parts.push(`<a rel="prev" href="${escape(urlOfPage(page - 1))}">Previous</a>`);
  let last = 0;
  for (let n = 1; n <= pages; n++) {
    if (n !== 1 && n !== pages && Math.abs(n - page) > 2) continue;
    if (n - last > 1) parts.push(`<span class="gap">&hellip;</span>`);
    parts.push(n === page ? `<em>${n}</em>` : `<a href="${escape(urlOfPage(n))}">${n}</a>`);
    last = n;
  }
  if (page < pages) parts.push(`<a rel="next" href="${escape(urlOfPage(page + 1))}">Next</a>`);
  return `<nav class="pagination">${parts.join(" ")}</nav>`;
}

export function issueListView(
  project: Project,
  filters: IssueFilters,
  issues: IssueSummary[],
  counts: StateCounts,
  labels: LabelCount[],
  signedIn: boolean,
): string {
  const url = (change: Partial<IssueFilters>) => escape(issueListUrl(project.slug, filters, { page: 1, ...change }));
  const selected = (yes: boolean) => (yes ? ` class="selected"` : "");
  const pages = Math.ceil(counts[filters.state] / filters.perPage);
  return `<nav class="breadcrumb"><a href="/">Projects</a> / ${escape(project.name)}</nav>
<h1>${escape(project.name)}</h1>
<p class="description">${escape(project.description)}</p>
${signedIn ? `<p><a class="button" href="/p/${project.slug}/issues/new">New issue</a></p>\n` : ""}<div class="columns">
<section>
<div class="tabs"><a${selected(filters.state === "open")} href="${url({ state: "open" })}">${formatNumber(counts.open)} open</a> <a${selected(
    filters.state === "closed",
  )} href="${url({ state: "closed" })}">${formatNumber(counts.closed)} closed</a></div>
<div class="sorts">${sorts.map(([sort, name]) => `<a${selected(filters.sort === sort)} href="${url({ sort })}">${name}</a>`).join(" ")}</div>
${
  issues.length === 0
    ? `<p class="empty">No issues match.</p>`
    : `<ul class="issues">\n${issues.map(issue => issueItem(project, issue)).join("\n")}\n</ul>`
}
${pagination(filters.page, pages, page => issueListUrl(project.slug, filters, { page }))}
</section>
<aside>
<h2>Labels</h2>
<ul class="labels">
${labels
  .map(
    label =>
      `<li${selected(filters.label === label.name)}><a href="${url({ label: filters.label === label.name ? null : label.name })}">${labelChip(
        label,
      )}</a> <span class="count">${formatNumber(label.openIssues)}</span></li>`,
  )
  .join("\n")}
</ul>
</aside>
</div>`;
}
