// What comes in from outside is checked here: a JSON body once it is parsed, what a form holds as an object.
import type { IssueState } from "./types";

export interface NewIssue {
  title: string;
  body: string;
  priority: number;
  labels: string[];
  assignee?: string | null;
}

export interface IssueChange {
  title?: string;
  body?: string;
  priority?: number;
  labels?: string[];
  assignee?: string | null;
  state?: IssueState;
}

export interface NewComment {
  body: string;
  parentId?: number | null;
}

export interface Credentials {
  login: string;
  password: string;
}

/** Either the value, or where it is wrong. `malformed`: it is no JSON, something has another type than it should have, or is missing. */
export type Checked<T> = { value: T; invalid?: undefined } | { value?: undefined; invalid: string[]; malformed: boolean };

const loginPattern = /^[a-z0-9-]{1,60}$/;

class Checker {
  invalid: string[] = [];
  malformed = false;

  constructor(readonly input: Record<string, unknown>) {}

  private wrongType(path: string): undefined {
    this.invalid.push(path);
    this.malformed = true;
  }

  text(name: string, least: number, most: number, value = this.input[name], path = name): string | undefined {
    if (typeof value !== "string") return this.wrongType(path);
    if (value.length < least || value.length > most) this.invalid.push(path);
    return value;
  }

  whole(name: string, least: number, most: number): number | undefined {
    const value = this.input[name];
    if (typeof value !== "number" || !Number.isInteger(value)) return this.wrongType(name);
    if (value < least || value > most) this.invalid.push(name);
    return value;
  }

  labels(name: string): string[] | undefined {
    const value = this.input[name];
    if (!Array.isArray(value)) return this.wrongType(name);
    if (value.length > 12) this.invalid.push(name);
    return value.map((label, index) => this.text(name, 1, 50, label, `${name}.${index}`) ?? "");
  }

  login(name: string): string | undefined {
    const value = this.input[name];
    if (typeof value !== "string") return this.wrongType(name);
    if (!loginPattern.test(value)) this.invalid.push(name);
    return value;
  }

  state(name: string): IssueState | undefined {
    const value = this.input[name];
    return value === "open" || value === "closed" ? value : this.wrongType(name);
  }

  has(name: string): boolean {
    return this.input[name] !== undefined;
  }

  result<T>(value: T): Checked<T> {
    return this.invalid.length === 0 ? { value } : { invalid: this.invalid, malformed: this.malformed };
  }
}

function checker(input: unknown): Checker | null {
  return typeof input === "object" && input !== null && !Array.isArray(input) ? new Checker(input as Record<string, unknown>) : null;
}

const noObject = { invalid: [""], malformed: true };

export function checkNewIssue(input: unknown): Checked<NewIssue> {
  const check = checker(input);
  if (!check) return noObject;
  const value: NewIssue = {
    title: check.text("title", 1, 200) ?? "",
    body: check.text("body", 0, 20000) ?? "",
    priority: check.whole("priority", 0, 3) ?? 0,
    labels: check.labels("labels") ?? [],
  };
  if (check.has("assignee")) value.assignee = check.input.assignee === null ? null : check.login("assignee");
  return check.result(value);
}

export function checkIssueChange(input: unknown): Checked<IssueChange> {
  const check = checker(input);
  if (!check) return noObject;
  const value: IssueChange = {};
  if (check.has("title")) value.title = check.text("title", 1, 200);
  if (check.has("body")) value.body = check.text("body", 0, 20000);
  if (check.has("priority")) value.priority = check.whole("priority", 0, 3);
  if (check.has("labels")) value.labels = check.labels("labels");
  if (check.has("assignee")) value.assignee = check.input.assignee === null ? null : check.login("assignee");
  if (check.has("state")) value.state = check.state("state");
  return check.result(value);
}

export function checkNewComment(input: unknown): Checked<NewComment> {
  const check = checker(input);
  if (!check) return noObject;
  const value: NewComment = { body: check.text("body", 1, 20000) ?? "" };
  if (check.has("parentId")) value.parentId = check.input.parentId === null ? null : check.whole("parentId", 1, 2147483647);
  return check.result(value);
}

export function checkCredentials(input: unknown): Checked<Credentials> {
  const check = checker(input);
  if (!check) return noObject;
  return check.result({ login: check.login("login") ?? "", password: check.text("password", 1, 200) ?? "" });
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function parseNewIssue(text: string): Checked<NewIssue> {
  return checkNewIssue(parsed(text));
}

export function parseIssueChange(text: string): Checked<IssueChange> {
  return checkIssueChange(parsed(text));
}

export function parseNewComment(text: string): Checked<NewComment> {
  return checkNewComment(parsed(text));
}
