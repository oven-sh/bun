import type { IssueState, Label, Project, Session } from "../types";
import { escape, priorityNames } from "./layout";

const messages: Record<string, string> = {
  title: "The title must have 1 to 200 characters.",
  body: "The text must have at most 20,000 characters.",
  priority: "Choose a priority.",
  labels: "Choose at most 12 labels.",
  assignee: "There is no user with that login.",
  state: "An issue is open or closed.",
  parentId: "The comment that this answers is not part of this issue.",
  login: "The login or the password is wrong.",
};

/** What is wrong with a form, for a person. `invalid` holds paths such as "title" or "labels.3". */
export function errorList(invalid: string[]): string {
  if (invalid.length === 0) return "";
  const fields = [...new Set(invalid.map(path => path.split(".")[0] ?? ""))];
  return `<ul class="errors">\n${fields.map(field => `<li>${messages[field] ?? "The form is not complete."}</li>`).join("\n")}\n</ul>\n`;
}

export interface IssueFormValues {
  title: string;
  body: string;
  priority: number;
  labels: string[];
  assignee: string;
  state: IssueState | null;
}

export function issueFormView(
  project: Project,
  number: number | null,
  values: IssueFormValues,
  labels: Label[],
  session: Session,
  invalid: string[],
): string {
  const issues = `/p/${project.slug}/issues`;
  const option = (value: string | number, name: string, selected: boolean) => `<option value="${value}"${selected ? " selected" : ""}>${name}</option>`;
  return `<nav class="breadcrumb"><a href="/">Projects</a> / <a href="${issues}">${escape(project.name)}</a> / ${
    number === null ? "New issue" : `<a href="${issues}/${number}">#${number}</a> / Edit`
  }</nav>
<h1>${number === null ? "New issue" : `Edit issue #${number}`}</h1>
${errorList(invalid)}<form method="post" action="${number === null ? issues : `${issues}/${number}`}">
<input type="hidden" name="csrf" value="${session.csrfToken}">
<label>Title <input name="title" value="${escape(values.title)}" required maxlength="200"></label>
<label>Text <textarea name="body" rows="12" maxlength="20000">${escape(values.body)}</textarea></label>
<label>Priority <select name="priority">${priorityNames.map((name, priority) => option(priority, name, priority === values.priority)).join("")}</select></label>
${
  values.state === null
    ? ""
    : `<label>State <select name="state">${option("open", "open", values.state === "open")}${option("closed", "closed", values.state === "closed")}</select></label>\n`
}<fieldset><legend>Labels</legend>
${labels
  .map(label => `<label><input type="checkbox" name="labels" value="${escape(label.name)}"${values.labels.includes(label.name) ? " checked" : ""}> ${escape(label.name)}</label>`)
  .join("\n")}
</fieldset>
<label>Assignee <input name="assignee" value="${escape(values.assignee)}" placeholder="login"></label>
<button>${number === null ? "Create issue" : "Save"}</button>
</form>`;
}

export function loginView(login: string, invalid: string[]): string {
  return `<h1>Sign in</h1>
${errorList(invalid)}<form method="post" action="/login">
<label>Login <input name="login" value="${escape(login)}" required autocomplete="username"></label>
<label>Password <input type="password" name="password" required autocomplete="current-password"></label>
<button>Sign in</button>
</form>`;
}
