import { formatNumber, timeTag } from "../format";
import type { IssueMention, ProjectSummary } from "../types";
import { escape, userLink } from "./layout";

export function issueMentionItem(issue: IssueMention): string {
  return `<li class="issue ${issue.state}"><a class="title" href="/p/${issue.project.slug}/issues/${issue.number}">${escape(issue.title)}</a>
<div class="meta"><a href="/p/${issue.project.slug}/issues">${escape(issue.project.name)}</a> #${issue.number} opened ${timeTag(issue.createdAt)} by ${userLink(
    issue.author,
  )}</div></li>`;
}

export function homeView(projects: ProjectSummary[], newest: IssueMention[]): string {
  return `<h1>Projects</h1>
<ul class="projects">
${projects
  .map(
    project => `<li><a href="/p/${project.slug}/issues">${escape(project.name)}</a> <span class="count">${formatNumber(project.openIssues)} open, ${formatNumber(
      project.closedIssues,
    )} closed</span>
<p>${escape(project.description)}</p></li>`,
  )
  .join("\n")}
</ul>
<h2>Newest issues</h2>
<ul class="issues">
${newest.map(issueMentionItem).join("\n")}
</ul>`;
}
