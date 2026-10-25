// What comes in from outside is checked against these types: a JSON body as it is parsed, what a form holds as an object.
import { JSON } from "bun"; import { validate } from "bun:bundle";
import type { Schema } from "bun";
import type { IssueState } from "./types";

type Title = string & Schema.MinLength<1> & Schema.MaxLength<200>;
type Text = string & Schema.MaxLength<20000>;
type Priority = number & Schema.Int & Schema.Min<0> & Schema.Max<3>;
type LabelNames = (string & Schema.MinLength<1> & Schema.MaxLength<50>)[] & Schema.MaxItems<12>;
type Login = string & Schema.Pattern<"^[a-z0-9-]{1,60}$">;

export interface NewIssue {
  title: Title;
  body: Text;
  priority: Priority;
  labels: LabelNames;
  assignee?: Login | null;
}

export interface IssueChange {
  title?: Title;
  body?: Text;
  priority?: Priority;
  labels?: LabelNames;
  assignee?: Login | null;
  state?: IssueState;
}

export interface NewComment {
  body: Text & Schema.MinLength<1>;
  parentId?: (number & Schema.Int & Schema.Min<1> & Schema.Max<2147483647>) | null;
}

export interface Credentials {
  login: Login;
  password: string & Schema.MinLength<1> & Schema.MaxLength<200>;
}

/** Either the value, or where it is wrong. `malformed`: it is no JSON, something has another type than it should have, or is missing. */
export type Checked<T> = { value: T; invalid?: undefined } | { value?: undefined; invalid: string[]; malformed: boolean };

function refused(error: unknown): { invalid: string[]; malformed: boolean } {
  if (!(error instanceof TypeError) || !("issues" in error)) return { invalid: [""], malformed: true };
  const issues = (error as Schema.Error).issues;
  return {
    invalid: [...new Set(issues.map(issue => issue.path.join(".")))],
    malformed: issues.some(issue => issue.code === "invalid_type"),
  };
}

export function parseNewIssue(text: string): Checked<NewIssue> {
  try {
    return { value: JSON.parse<NewIssue>(text) };
  } catch (error) {
    return refused(error);
  }
}

export function parseIssueChange(text: string): Checked<IssueChange> {
  try {
    return { value: JSON.parse<IssueChange>(text) };
  } catch (error) {
    return refused(error);
  }
}

export function parseNewComment(text: string): Checked<NewComment> {
  try {
    return { value: JSON.parse<NewComment>(text) };
  } catch (error) {
    return refused(error);
  }
}

export function checkNewIssue(input: unknown): Checked<NewIssue> {
  try {
    return { value: validate<NewIssue>(input) };
  } catch (error) {
    return refused(error);
  }
}

export function checkIssueChange(input: unknown): Checked<IssueChange> {
  try {
    return { value: validate<IssueChange>(input) };
  } catch (error) {
    return refused(error);
  }
}

export function checkNewComment(input: unknown): Checked<NewComment> {
  try {
    return { value: validate<NewComment>(input) };
  } catch (error) {
    return refused(error);
  }
}

export function checkCredentials(input: unknown): Checked<Credentials> {
  try {
    return { value: validate<Credentials>(input) };
  } catch (error) {
    return refused(error);
  }
}
