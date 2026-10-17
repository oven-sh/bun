// What comes in from outside is checked against these types.
import type { Int, Max, MaxItems, MaxLength, Min, MinLength, Pattern, ValidationIssue } from "bun";
import type { IssueState } from "./types";

type Title = string & MinLength<1> & MaxLength<200>;
type Text = string & MaxLength<20000>;
type Priority = number & Int & Min<0> & Max<3>;
type LabelNames = (string & MinLength<1> & MaxLength<50>)[] & MaxItems<12>;
type Login = string & Pattern<"^[a-z0-9-]{1,60}$">;

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
  body: Text & MinLength<1>;
  parentId?: (number & Int & Min<1> & Max<2147483647>) | null;
}

export interface Credentials {
  login: Login;
  password: string & MinLength<1> & MaxLength<200>;
}

/** Either the value, or where it is wrong. `malformed`: something has another type than it should have, or is missing. */
export type Checked<T> = { value: T; invalid?: undefined } | { value?: undefined; invalid: string[]; malformed: boolean };

function refused(issues: ValidationIssue[]): { invalid: string[]; malformed: boolean } {
  return {
    invalid: [...new Set(issues.map(issue => issue.path.join(".")))],
    malformed: issues.some(issue => issue.code === "invalid_type"),
  };
}

export function checkNewIssue(input: unknown): Checked<NewIssue> {
  const result = Bun.safeValidate<NewIssue>(input);
  return result.success ? { value: result.data } : refused(result.issues);
}

export function checkIssueChange(input: unknown): Checked<IssueChange> {
  const result = Bun.safeValidate<IssueChange>(input);
  return result.success ? { value: result.data } : refused(result.issues);
}

export function checkNewComment(input: unknown): Checked<NewComment> {
  const result = Bun.safeValidate<NewComment>(input);
  return result.success ? { value: result.data } : refused(result.issues);
}

export function checkCredentials(input: unknown): Checked<Credentials> {
  const result = Bun.safeValidate<Credentials>(input);
  return result.success ? { value: result.data } : refused(result.issues);
}
