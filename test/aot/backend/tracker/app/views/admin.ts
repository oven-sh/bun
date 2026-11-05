import { formatNumber } from "../format";
import type { AdminStats } from "../types";
import { escape, priorityNames, userLink } from "./layout";

function duration(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return days > 0 ? `${formatNumber(days)} d ${hours} h` : `${hours} h ${minutes % 60} min`;
}

/** Two bars a month: opened and closed. */
function chart(months: AdminStats["months"]): string {
  const most = Math.max(1, ...months.map(month => Math.max(month.opened, month.closed)));
  const bar = (kind: string, x: number, count: number) => {
    const height = Math.floor((count * 120) / most);
    return `<rect class="${kind}" x="${x}" y="${120 - height}" width="14" height="${height}"><title>${formatNumber(count)} ${kind}</title></rect>`;
  };
  return `<svg class="chart" viewBox="0 0 ${months.length * 40} 140" width="${months.length * 40}" height="140" role="img">
${months
  .map(
    (month, index) =>
      `${bar("opened", index * 40 + 4, month.opened)}${bar("closed", index * 40 + 20, month.closed)}<text x="${index * 40 + 4}" y="134" font-size="9">${month.month.slice(2)}</text>`,
  )
  .join("\n")}
</svg>`;
}

export function adminView(stats: AdminStats): string {
  const { totals } = stats;
  return `<h1>Admin</h1>
<table>
<tr><th>Users</th><th>Projects</th><th>Open issues</th><th>Closed issues</th><th>Comments</th></tr>
<tr><td>${formatNumber(totals.users)}</td><td>${formatNumber(totals.projects)}</td><td>${formatNumber(totals.openIssues)}</td><td>${formatNumber(
    totals.closedIssues,
  )}</td><td>${formatNumber(totals.comments)}</td></tr>
</table>
<h2>Opened and closed by month</h2>
${chart(stats.months)}
<table>
<tr><th>Month</th><th>Opened</th><th>Closed</th><th>Net</th></tr>
${stats.months
  .map(({ month, opened, closed }) => `<tr><td>${month}</td><td>${formatNumber(opened)}</td><td>${formatNumber(closed)}</td><td>${formatNumber(opened - closed)}</td></tr>`)
  .join("\n")}
</table>
<h2>By priority</h2>
<table>
<tr><th>Priority</th><th>Open</th><th>Mean time to close</th></tr>
${stats.priorities
  .map(({ priority, open, minutesToClose }) => `<tr><td>${priorityNames[priority]}</td><td>${formatNumber(open)}</td><td>${duration(minutesToClose)}</td></tr>`)
  .join("\n")}
</table>
<h2>Who comments most</h2>
<ol>
${stats.commenters.map(user => `<li>${userLink(user)} <span class="count">${formatNumber(user.comments)}</span></li>`).join("\n")}
</ol>
<h2>Where most is said</h2>
<ol>
${stats.busiest
  .map(project => `<li><a href="/p/${project.slug}/issues">${escape(project.name)}</a> <span class="count">${formatNumber(project.comments)}</span></li>`)
  .join("\n")}
</ol>`;
}
