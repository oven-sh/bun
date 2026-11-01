import type { Label, Session, UserRef } from "../types";

export const escape = Bun.escapeHTML;

export interface Page {
  title: string;
  session: Session | null;
  content: string;
  searchText?: string;
}

function account(session: Session | null): string {
  if (!session) return `<a href="/login">Sign in</a>`;
  const { user } = session;
  return `${user.role === "admin" ? `<a href="/admin">Admin</a> ` : ""}<a href="/u/${user.login}">${escape(user.name)}</a>
<form method="post" action="/logout"><input type="hidden" name="csrf" value="${session.csrfToken}"><button>Sign out</button></form>`;
}

export function layout({ title, session, content, searchText = "" }: Page): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · Tracker</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<header class="site">
<a class="brand" href="/">Tracker</a>
<form class="search" action="/search"><input type="search" name="q" placeholder="Search issues" value="${escape(searchText)}"></form>
<nav>${account(session)}</nav>
</header>
${session?.flash ? `<p class="flash">${escape(session.flash)}</p>\n` : ""}<main>
${content}
</main>
<footer>Tracker, a program for measuring. <a href="/api/projects">API</a></footer>
</body>
</html>
`;
}

export function userLink(user: UserRef): string {
  return `<a class="user" href="/u/${user.login}">${escape(user.name)}</a>`;
}

export function labelChip(label: Label): string {
  return `<span class="label" style="background:#${label.color}">${escape(label.name)}</span>`;
}

export const priorityNames = ["low", "normal", "high", "urgent"];
