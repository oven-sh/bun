import { formatCount, formatMinute, timeTag } from "../format";
import { renderMarkdown } from "../markdown";
import type { CommentNode, Issue, Participant, Project, Session } from "../types";
import { escape, labelChip, priorityNames, userLink } from "./layout";

const deepestIndent = 6;

function commentView(project: Project, issue: Issue, comment: CommentNode, depth: number, session: Session | null): string {
  const replies = comment.replies.map(reply => commentView(project, issue, reply, depth + 1, session)).join("\n");
  return `<article class="comment" id="comment-${comment.id}">
<header>${userLink(comment.author)}${comment.author.login === issue.author.login ? ` <span class="badge">Author</span>` : ""} <a class="permalink" href="#comment-${
    comment.id
  }">${timeTag(comment.createdAt, formatMinute(comment.createdAt))}</a>${comment.editedAt ? ` <span class="edited">edited ${timeTag(comment.editedAt)}</span>` : ""}</header>
<div class="markdown">
${renderMarkdown(comment.body, project.slug)}</div>
${session ? `<a class="reply" href="?reply_to=${comment.id}#reply">Reply</a>\n` : ""}${
    replies === "" ? "" : depth < deepestIndent ? `<div class="replies">\n${replies}\n</div>\n` : `${replies}\n`
  }</article>`;
}

function commentForm(project: Project, issue: Issue, session: Session, replyTo: number | null): string {
  return `<form id="reply" method="post" action="/p/${project.slug}/issues/${issue.number}/comments">
<input type="hidden" name="csrf" value="${session.csrfToken}">
${replyTo === null ? "" : `<input type="hidden" name="parent_id" value="${replyTo}">\n<p>Replying to <a href="#comment-${replyTo}">a comment</a>.</p>\n`}<textarea name="body" rows="6" required maxlength="20000" placeholder="Leave a comment"></textarea>
<button>Comment</button>
</form>`;
}

export function issuePageView(
  project: Project,
  issue: Issue,
  thread: CommentNode[],
  participants: Participant[],
  session: Session | null,
  replyTo: number | null,
): string {
  return `<nav class="breadcrumb"><a href="/">Projects</a> / <a href="/p/${project.slug}/issues">${escape(project.name)}</a> / #${issue.number}</nav>
<h1>${escape(issue.title)} <span class="number">#${issue.number}</span></h1>
<p class="meta"><span class="state ${issue.state}">${issue.state === "open" ? "Open" : "Closed"}</span> ${userLink(issue.author)} opened this issue on ${timeTag(
    issue.createdAt,
  )}, ${formatCount(issue.commentCount, "comment")}${issue.closedAt ? `, closed on ${timeTag(issue.closedAt)}` : ""}</p>
<div class="columns">
<section>
<div class="markdown">
${renderMarkdown(issue.body, project.slug)}</div>
${thread.map(comment => commentView(project, issue, comment, 0, session)).join("\n")}
${session ? commentForm(project, issue, session, replyTo) : `<p><a href="/login">Sign in</a> to comment.</p>`}
</section>
<aside>
<h2>Priority</h2>
<p class="priority-${priorityNames[issue.priority]}">${priorityNames[issue.priority]}</p>
<h2>Assignee</h2>
<p>${issue.assignee ? userLink(issue.assignee) : "No one"}</p>
<h2>Labels</h2>
<p>${issue.labels.length === 0 ? "None" : issue.labels.map(labelChip).join(" ")}</p>
<h2>${formatCount(participants.length, "participant")}</h2>
<ul class="participants">
${participants.map(participant => `<li>${userLink(participant)} <span class="count">${participant.comments}</span></li>`).join("\n")}
</ul>
${
  session && (session.user.login === issue.author.login || session.user.role === "admin")
    ? `<p><a class="button" href="/p/${project.slug}/issues/${issue.number}/edit">Edit</a></p>\n`
    : ""
}</aside>
</div>`;
}
