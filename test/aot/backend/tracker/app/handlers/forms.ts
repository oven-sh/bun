// What a browser posts: forms, checked against the session's token, answered with a redirect or with the form and what is wrong with it.
import type { BunRequest } from "bun";
import { positiveInteger } from "../filters";
import { html, seeOther } from "../http";
import { passwordMatches } from "../passwords";
import { findIssue, findProject, labelsOf } from "../queries/issues";
import { labelsOfProject } from "../queries/projects";
import { findPassword, findUserId } from "../queries/users";
import { commentBelongsTo, insertComment, insertIssue, updateIssue } from "../queries/writes";
import { endSession, findSession, startSession } from "../sessions";
import type { Issue, Project, Session } from "../types";
import { checkCredentials, checkIssueChange, checkNewComment, checkNewIssue } from "../validation";
import { errorPage } from "../views/errors";
import { issueFormView, loginView, type IssueFormValues } from "../views/forms";
import { layout } from "../views/layout";
import { notFoundPage } from "./pages";

async function formOf(request: Request): Promise<URLSearchParams> {
  return new URLSearchParams(await request.text());
}

function field(form: URLSearchParams, name: string): string {
  return form.get(name) ?? "";
}

function text(form: URLSearchParams, name: string): string {
  return field(form, name).replaceAll("\r\n", "\n").trim();
}

function forbidden(session: Session | null, message: string): Response {
  return html(errorPage(session, "Forbidden", message), 403);
}

/** The form of a request by someone who is signed in and whose form carries the token of the session. Otherwise, what to answer. */
async function signedForm(request: BunRequest): Promise<{ session: Session; form: URLSearchParams } | Response> {
  const [session, form] = await Promise.all([findSession(request), formOf(request)]);
  if (!session) return seeOther("/login");
  if (field(form, "csrf") !== session.csrfToken) return forbidden(session, "The form has expired. Go back, reload the page and try again.");
  return { session, form };
}

function mayEdit(session: Session, issue: Issue): boolean {
  return session.user.login === issue.author.login || session.user.role === "admin";
}

function issueValues(form: URLSearchParams, withState: boolean): IssueFormValues {
  const state = field(form, "state");
  return {
    title: text(form, "title"),
    body: text(form, "body"),
    priority: Number(field(form, "priority") || NaN),
    labels: form.getAll("labels"),
    assignee: field(form, "assignee").trim(),
    state: withState ? (state === "closed" ? "closed" : "open") : null,
  };
}

async function issueFormPage(
  project: Project,
  number: number | null,
  values: IssueFormValues,
  session: Session,
  invalid: string[],
  status = 200,
): Promise<Response> {
  const labels = await labelsOfProject(project.id);
  return html(
    layout({
      title: number === null ? `New issue in ${project.name}` : `Edit issue #${number}`,
      session,
      content: issueFormView(project, number, values, labels, session, invalid),
    }),
    status,
  );
}

export async function newIssuePage(request: BunRequest<"/p/:project/issues/new">): Promise<Response> {
  const [session, project] = await Promise.all([findSession(request), findProject(request.params.project)]);
  if (!project) return notFoundPage(session);
  if (!session) return seeOther("/login");
  return issueFormPage(project, null, { title: "", body: "", priority: 1, labels: [], assignee: "", state: null }, session, []);
}

export async function createIssue(request: BunRequest<"/p/:project/issues">): Promise<Response> {
  const signed = await signedForm(request);
  if (signed instanceof Response) return signed;
  const { session, form } = signed;
  const project = await findProject(request.params.project);
  if (!project) return notFoundPage(session);

  const values = issueValues(form, false);
  const checked = checkNewIssue({ ...values, assignee: values.assignee || null });
  if (checked.invalid) return issueFormPage(project, null, values, session, checked.invalid, 422);
  const { title, body, priority, labels, assignee } = checked.value;
  const assigneeId = assignee ? await findUserId(assignee) : null;
  if (assignee && assigneeId === null) return issueFormPage(project, null, values, session, ["assignee"], 422);

  const number = await insertIssue(project, session, { title, body, priority, labels, assigneeId }, "The issue was created.");
  return seeOther(`/p/${project.slug}/issues/${number}`);
}

export async function editIssuePage(request: BunRequest<"/p/:project/issues/:number/edit">): Promise<Response> {
  const number = positiveInteger(request.params.number);
  const [session, found] = await Promise.all([findSession(request), number === null ? null : findIssue(request.params.project, number)]);
  if (!found) return notFoundPage(session);
  if (!session) return seeOther("/login");
  const { project, issue } = found;
  if (!mayEdit(session, issue)) return forbidden(session, "Only the author of an issue can edit it.");
  const labels = await labelsOf(issue.id);
  return issueFormPage(
    project,
    issue.number,
    {
      title: issue.title,
      body: issue.body,
      priority: issue.priority,
      labels: labels.map(label => label.name),
      assignee: issue.assignee?.login ?? "",
      state: issue.state,
    },
    session,
    [],
  );
}

export async function saveIssue(request: BunRequest<"/p/:project/issues/:number">): Promise<Response> {
  const signed = await signedForm(request);
  if (signed instanceof Response) return signed;
  const { session, form } = signed;
  const number = positiveInteger(request.params.number);
  const found = number === null ? null : await findIssue(request.params.project, number);
  if (!found) return notFoundPage(session);
  const { project, issue } = found;
  if (!mayEdit(session, issue)) return forbidden(session, "Only the author of an issue can edit it.");

  const values = issueValues(form, true);
  const checked = checkIssueChange({ ...values, assignee: values.assignee || null });
  if (checked.invalid) return issueFormPage(project, issue.number, values, session, checked.invalid, 422);
  const { title = issue.title, body = issue.body, priority = issue.priority, labels = [], assignee, state = issue.state } = checked.value;
  const assigneeId = assignee ? await findUserId(assignee) : null;
  if (assignee && assigneeId === null) return issueFormPage(project, issue.number, values, session, ["assignee"], 422);

  await updateIssue(project, issue, session, { title, body, priority, labels, assigneeId }, state, "The issue was saved.");
  return seeOther(`/p/${project.slug}/issues/${issue.number}`);
}

export async function createComment(request: BunRequest<"/p/:project/issues/:number/comments">): Promise<Response> {
  const signed = await signedForm(request);
  if (signed instanceof Response) return signed;
  const { session, form } = signed;
  const number = positiveInteger(request.params.number);
  const found = number === null ? null : await findIssue(request.params.project, number);
  if (!found) return notFoundPage(session);
  const { project, issue } = found;

  const parent = field(form, "parent_id");
  const checked = checkNewComment({ body: text(form, "body"), parentId: parent === "" ? null : Number(parent) });
  const parentId = checked.value?.parentId ?? null;
  if (checked.invalid || (parentId !== null && !(await commentBelongsTo(parentId, issue.id))))
    return html(errorPage(session, "The comment was not saved", "A comment must have 1 to 20,000 characters and answer a comment of the same issue."), 422);

  const comment = await insertComment(issue, session, checked.value.body, parentId, "Your comment was added.");
  return seeOther(`/p/${project.slug}/issues/${issue.number}#comment-${comment.id}`);
}

export async function loginPage(request: BunRequest<"/login">): Promise<Response> {
  const session = await findSession(request);
  return session ? seeOther("/") : html(layout({ title: "Sign in", session, content: loginView("", []) }));
}

export async function login(request: BunRequest<"/login">): Promise<Response> {
  const form = await formOf(request);
  const checked = checkCredentials({ login: field(form, "login").trim(), password: field(form, "password") });
  const password = checked.value ? await findPassword(checked.value.login) : null;
  if (!checked.value || !password || !(await passwordMatches(checked.value.password, password.salt, password.hash)))
    return html(layout({ title: "Sign in", session: null, content: loginView(field(form, "login").trim(), ["login"]) }), 401);
  await startSession(request, password.userId);
  return seeOther("/");
}

export async function logout(request: BunRequest<"/logout">): Promise<Response> {
  const signed = await signedForm(request);
  if (signed instanceof Response) return signed;
  await endSession(request, signed.session);
  return seeOther("/");
}
