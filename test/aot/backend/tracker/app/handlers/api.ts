import type { BunRequest } from "bun";
import { summary } from "../excerpt";
import { parseFilters, positiveInteger, wholeNumber } from "../filters";
import { json, notModified, problem, searchParams } from "../http";
import { adminStats } from "../queries/admin";
import { commentsOf, countByState, findIssue, findProject, labelsOf, listIssues } from "../queries/issues";
import { listProjects } from "../queries/projects";
import { countHits, searchIssues } from "../queries/search";
import { findUserId } from "../queries/users";
import { commentBelongsTo, insertComment, insertIssue, updateIssue } from "../queries/writes";
import { findBearerSession } from "../sessions";
import { buildThread, participantsOf } from "../thread";
import { parseIssueChange, parseNewComment, parseNewIssue } from "../validation";
import { loadProfile } from "./pages";

export async function apiIssueList(request: BunRequest<"/api/projects/:project/issues">): Promise<Response> {
  const project = await findProject(request.params.project);
  if (!project) return problem(404, "no such project");
  const filters = parseFilters(searchParams(request), 50, 100);
  const [issues, counts] = await Promise.all([listIssues(project.id, filters), countByState(project.id, filters.label)]);
  return json({ project, filters, total: counts[filters.state], issues });
}

export async function apiIssue(request: BunRequest<"/api/projects/:project/issues/:number">): Promise<Response> {
  const number = positiveInteger(request.params.number);
  const found = number === null ? null : await findIssue(request.params.project, number);
  if (!found) return problem(404, "no such issue");
  const { project, issue } = found;

  const etag = `"${issue.id}-${issue.updatedAt.getTime()}-${issue.commentCount}"`;
  const unchanged = notModified(request, etag);
  if (unchanged) return unchanged;

  const [labels, comments] = await Promise.all([labelsOf(issue.id), commentsOf(issue.id)]);
  issue.labels = labels;
  return json({ project, issue, participants: participantsOf(comments), comments: buildThread(comments) }, 200, { ETag: etag });
}

export async function apiProjects(): Promise<Response> {
  return json({ projects: await listProjects() });
}

export async function apiSearch(request: Request): Promise<Response> {
  const params = searchParams(request);
  const text = (params.get("q") ?? "").trim();
  if (text === "") return problem(400, "q is missing");
  const page = wholeNumber(params.get("page"), 1, 1, 1000);
  const [hits, total] = await Promise.all([searchIssues(text, 20, (page - 1) * 20), countHits(text)]);
  return json({ query: text, page, total, hits: hits.map(({ body, ...hit }) => ({ ...hit, summary: summary(body, 30) })) });
}

export async function apiUser(request: BunRequest<"/api/users/:login">): Promise<Response> {
  const profile = await loadProfile(request.params.login);
  return profile ? json(profile) : problem(404, "no such user");
}

export async function apiAdminStats(request: Request): Promise<Response> {
  const session = await findBearerSession(request);
  if (!session) return problem(401, "not signed in");
  if (session.user.role !== "admin") return problem(403, "for administrators");
  return json(await adminStats());
}

function refusal(invalid: string[], malformed: boolean): Response {
  return malformed ? problem(400, "malformed") : json({ error: "invalid", fields: invalid }, 422);
}

/** The body of a request as text. A body that cannot be read is empty, which is no JSON. */
async function bodyOf(request: Request): Promise<string> {
  try {
    return await request.text();
  } catch {
    return "";
  }
}

export async function apiCreateIssue(request: BunRequest<"/api/projects/:project/issues">): Promise<Response> {
  const [session, project, input] = await Promise.all([findBearerSession(request), findProject(request.params.project), bodyOf(request)]);
  if (!session) return problem(401, "not signed in");
  if (!project) return problem(404, "no such project");
  const checked = parseNewIssue(input);
  if (checked.invalid) return refusal(checked.invalid, checked.malformed);
  const { title, body, priority, labels, assignee } = checked.value;
  const assigneeId = assignee ? await findUserId(assignee) : null;
  if (assignee && assigneeId === null) return refusal(["assignee"], false);
  const number = await insertIssue(project, session, { title, body, priority, labels, assigneeId }, null);
  return json({ number, url: `/api/projects/${project.slug}/issues/${number}` }, 201);
}

export async function apiUpdateIssue(request: BunRequest<"/api/projects/:project/issues/:number">): Promise<Response> {
  const number = positiveInteger(request.params.number);
  const [session, found, input] = await Promise.all([
    findBearerSession(request),
    number === null ? null : findIssue(request.params.project, number),
    bodyOf(request),
  ]);
  if (!session) return problem(401, "not signed in");
  if (!found) return problem(404, "no such issue");
  const { project, issue } = found;
  if (session.user.login !== issue.author.login && session.user.role !== "admin") return problem(403, "not your issue");
  const checked = parseIssueChange(input);
  if (checked.invalid) return refusal(checked.invalid, checked.malformed);
  const change = checked.value;

  const assignee = change.assignee === undefined ? (issue.assignee?.login ?? null) : change.assignee;
  const [assigneeId, labels] = await Promise.all([
    assignee === null ? null : findUserId(assignee),
    change.labels ?? labelsOf(issue.id).then(labels => labels.map(label => label.name)),
  ]);
  if (assignee !== null && assigneeId === null) return refusal(["assignee"], false);
  await updateIssue(
    project,
    issue,
    session,
    { title: change.title ?? issue.title, body: change.body ?? issue.body, priority: change.priority ?? issue.priority, labels, assigneeId },
    change.state ?? issue.state,
    null,
  );
  return json({ number: issue.number, url: `/api/projects/${project.slug}/issues/${issue.number}` });
}

export async function apiCreateComment(request: BunRequest<"/api/projects/:project/issues/:number/comments">): Promise<Response> {
  const number = positiveInteger(request.params.number);
  const [session, found, input] = await Promise.all([
    findBearerSession(request),
    number === null ? null : findIssue(request.params.project, number),
    bodyOf(request),
  ]);
  if (!session) return problem(401, "not signed in");
  if (!found) return problem(404, "no such issue");
  const checked = parseNewComment(input);
  if (checked.invalid) return refusal(checked.invalid, checked.malformed);
  const parentId = checked.value.parentId ?? null;
  if (parentId !== null && !(await commentBelongsTo(parentId, found.issue.id))) return refusal(["parentId"], false);
  const comment = await insertComment(found.issue, session, checked.value.body, parentId, null);
  return json({ id: comment.id, parentId, author: { login: session.user.login, name: session.user.name }, body: checked.value.body, createdAt: comment.createdAt }, 201);
}
