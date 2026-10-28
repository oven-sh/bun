export type IssueState = "open" | "closed";

export type Role = "member" | "admin";

export interface UserRef {
  login: string;
  name: string;
}

export interface Project {
  id: number;
  slug: string;
  name: string;
  description: string;
}

export interface Label {
  id: number;
  name: string;
  color: string;
}

export interface LabelCount extends Label {
  openIssues: number;
}

export interface IssueSummary {
  id: number;
  number: number;
  title: string;
  state: IssueState;
  priority: number;
  commentCount: number;
  createdAt: Date;
  updatedAt: Date;
  author: UserRef;
  assignee: UserRef | null;
  labels: Label[];
}

export interface Issue extends IssueSummary {
  body: string;
  closedAt: Date | null;
}

export interface Comment {
  id: number;
  parentId: number | null;
  author: UserRef;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
}

export interface CommentNode extends Comment {
  replies: CommentNode[];
}

export interface Participant extends UserRef {
  comments: number;
}

export interface StateCounts {
  open: number;
  closed: number;
}

export interface Session {
  token: string;
  csrfToken: string;
  flash: string | null;
  user: { id: number; login: string; name: string; role: Role };
}

export interface ProjectSummary extends Project {
  openIssues: number;
  closedIssues: number;
}

/** An issue as it is shown outside the pages of its project. */
export interface IssueMention {
  project: { slug: string; name: string };
  number: number;
  title: string;
  state: IssueState;
  createdAt: Date;
  author: UserRef;
}

export interface SearchHit extends IssueMention {
  body: string;
  commentCount: number;
}

export interface User {
  id: number;
  login: string;
  name: string;
  bio: string;
  role: Role;
  createdAt: Date;
}

export interface CommentMention {
  id: number;
  project: { slug: string; name: string };
  issue: { number: number; title: string };
  body: string;
  createdAt: Date;
}

export interface Profile {
  user: User;
  issueCount: number;
  commentCount: number;
  issues: IssueMention[];
  comments: CommentMention[];
}

export interface AdminStats {
  totals: { users: number; projects: number; openIssues: number; closedIssues: number; comments: number };
  months: { month: string; opened: number; closed: number }[];
  priorities: { priority: number; open: number; minutesToClose: number }[];
  commenters: { login: string; name: string; comments: number }[];
  busiest: { slug: string; name: string; comments: number }[];
}
