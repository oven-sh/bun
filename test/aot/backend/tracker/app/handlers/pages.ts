import type { BunRequest } from "bun";
import { stylesheet, stylesheetTag } from "../assets";
import { wordsOf } from "../excerpt";
import { parseFilters, positiveInteger, wholeNumber } from "../filters";
import { html, notModified, searchParams, seeOther } from "../http";
import { adminStats } from "../queries/admin";
import { commentsOf, countByLabel, countByState, findIssue, findProject, labelsOf, listIssues } from "../queries/issues";
import { listProjects, newestIssues } from "../queries/projects";
import { countHits, searchIssues } from "../queries/search";
import { commentsBy, countWritten, findUser, issuesBy } from "../queries/users";
import { findSession } from "../sessions";
import { buildThread, participantsOf } from "../thread";
import type { Profile, Session } from "../types";
import { adminView } from "../views/admin";
import { errorPage } from "../views/errors";
import { homeView } from "../views/home";
import { issueListView } from "../views/issue-list";
import { issuePageView } from "../views/issue-page";
import { layout } from "../views/layout";
import { profileView } from "../views/profile";
import { searchView } from "../views/search";

export function notFoundPage(session: Session | null): Response {
  return html(errorPage(session, "Not found", "There is no such page."), 404);
}

export async function issueListPage(request: BunRequest<"/p/:project/issues">): Promise<Response> {
  const [session, project] = await Promise.all([findSession(request), findProject(request.params.project)]);
  if (!project) return notFoundPage(session);
  const filters = parseFilters(searchParams(request), 25, 25);
  const [issues, counts, labels] = await Promise.all([
    listIssues(project.id, filters),
    countByState(project.id, filters.label),
    countByLabel(project.id),
  ]);
  return html(
    layout({
      title: `Issues of ${project.name}`,
      session,
      content: issueListView(project, filters, issues, counts, labels, session !== null),
    }),
  );
}

export async function issuePage(request: BunRequest<"/p/:project/issues/:number">): Promise<Response> {
  const number = positiveInteger(request.params.number);
  const [session, found] = await Promise.all([findSession(request), number === null ? null : findIssue(request.params.project, number)]);
  if (!found) return notFoundPage(session);
  const { project, issue } = found;

  const etag = `"${issue.id}-${issue.updatedAt.getTime()}-${issue.commentCount}-${session?.user.id ?? 0}"`;
  if (!session?.flash) {
    const unchanged = notModified(request, etag);
    if (unchanged) return unchanged;
  }

  const [labels, comments] = await Promise.all([labelsOf(issue.id), commentsOf(issue.id)]);
  issue.labels = labels;
  const replyTo = searchParams(request).get("reply_to");
  return html(
    layout({
      title: `${issue.title} · Issue #${issue.number}`,
      session,
      content: issuePageView(
        project,
        issue,
        buildThread(comments),
        participantsOf(comments),
        session,
        replyTo === null ? null : positiveInteger(replyTo),
      ),
    }),
    200,
    { ETag: etag, "Cache-Control": "private, no-cache" },
  );
}

export async function homePage(request: BunRequest<"/">): Promise<Response> {
  const [session, projects, newest] = await Promise.all([findSession(request), listProjects(), newestIssues(10)]);
  return html(layout({ title: "Projects", session, content: homeView(projects, newest) }));
}

export function stylesheetFile(request: Request): Response {
  return (
    notModified(request, stylesheetTag) ??
    new Response(stylesheet, { headers: { "Content-Type": "text/css; charset=utf-8", ETag: stylesheetTag, "Cache-Control": "public, max-age=3600" } })
  );
}

const hitsPerPage = 20;

export async function searchPage(request: BunRequest<"/search">): Promise<Response> {
  const params = searchParams(request);
  const text = (params.get("q") ?? "").trim();
  const page = wholeNumber(params.get("page"), 1, 1, 1000);
  const [session, hits, total] = await Promise.all([
    findSession(request),
    text === "" ? [] : searchIssues(text, hitsPerPage, (page - 1) * hitsPerPage),
    text === "" ? 0 : countHits(text),
  ]);
  return html(
    layout({
      title: text === "" ? "Search" : `Search: ${text}`,
      session,
      searchText: text,
      content: searchView(text, wordsOf(text.toLowerCase()), hits, total, page, hitsPerPage),
    }),
  );
}

export async function loadProfile(login: string): Promise<Profile | null> {
  const user = await findUser(login);
  if (!user) return null;
  const [counts, issues, comments] = await Promise.all([countWritten(user.id), issuesBy(user.id, 10), commentsBy(user.id, 10)]);
  return { user, issueCount: counts.issues, commentCount: counts.comments, issues, comments };
}

export async function profilePage(request: BunRequest<"/u/:login">): Promise<Response> {
  const [session, profile] = await Promise.all([findSession(request), loadProfile(request.params.login)]);
  if (!profile) return notFoundPage(session);
  return html(layout({ title: profile.user.name, session, content: profileView(profile) }));
}

export async function adminPage(request: BunRequest<"/admin">): Promise<Response> {
  const session = await findSession(request);
  if (!session) return seeOther("/login");
  if (session.user.role !== "admin") return html(errorPage(session, "Forbidden", "This page is for administrators."), 403);
  return html(layout({ title: "Admin", session, content: adminView(await adminStats()) }));
}
