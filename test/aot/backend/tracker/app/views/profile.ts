import { summary } from "../excerpt";
import { formatCount, timeTag } from "../format";
import type { Profile } from "../types";
import { issueMentionItem } from "./home";
import { escape } from "./layout";

export function profileView({ user, issueCount, commentCount, issues, comments }: Profile): string {
  return `<h1>${escape(user.name)} <span class="login">@${user.login}</span>${user.role === "admin" ? ` <span class="badge">Admin</span>` : ""}</h1>
<p class="bio">${escape(user.bio)}</p>
<p class="meta">Joined ${timeTag(user.createdAt)}, ${formatCount(issueCount, "issue")}, ${formatCount(commentCount, "comment")}</p>
<h2>Newest issues</h2>
${issues.length === 0 ? `<p class="empty">None yet.</p>` : `<ul class="issues">\n${issues.map(issueMentionItem).join("\n")}\n</ul>`}
<h2>Newest comments</h2>
${
  comments.length === 0
    ? `<p class="empty">None yet.</p>`
    : `<ul class="comments">\n${comments
        .map(
          comment => `<li><a href="/p/${comment.project.slug}/issues/${comment.issue.number}#comment-${comment.id}">${escape(comment.issue.title)}</a> <span class="meta">${escape(
            comment.project.name,
          )} #${comment.issue.number}, ${timeTag(comment.createdAt)}</span>
<p>${escape(summary(comment.body, 24))}</p></li>`,
        )
        .join("\n")}\n</ul>`
}`;
}
