import type { IssueState } from "./types";

export type IssueSort = "updated" | "created" | "comments";

export interface IssueFilters {
  state: IssueState;
  label: string | null;
  sort: IssueSort;
  page: number;
  perPage: number;
}

export function wholeNumber(text: string | null, fallback: number, least: number, most: number): number {
  const n = text === null ? NaN : parseInt(text, 10);
  return Number.isNaN(n) ? fallback : Math.min(Math.max(n, least), most);
}

/** The number that a part of a path spells, if it is one that a row can have. */
export function positiveInteger(text: string): number | null {
  return /^[1-9][0-9]{0,8}$/.test(text) ? Number(text) : null;
}

export function parseFilters(params: URLSearchParams, perPage: number, mostPerPage: number): IssueFilters {
  const sort = params.get("sort");
  return {
    state: params.get("state") === "closed" ? "closed" : "open",
    label: params.get("label") || null,
    sort: sort === "created" || sort === "comments" ? sort : "updated",
    page: wholeNumber(params.get("page"), 1, 1, 100_000),
    perPage: wholeNumber(params.get("per_page"), perPage, 1, mostPerPage),
  };
}

/** The address of the list of a project's issues under these filters. What is as by default is left out. */
export function issueListUrl(projectSlug: string, filters: IssueFilters, change: Partial<IssueFilters> = {}): string {
  const { state, label, sort, page } = { ...filters, ...change };
  const params = new URLSearchParams();
  if (state !== "open") params.set("state", state);
  if (label !== null) params.set("label", label);
  if (sort !== "updated") params.set("sort", sort);
  if (page !== 1) params.set("page", String(page));
  const query = params.toString();
  return `/p/${projectSlug}/issues${query && `?${query}`}`;
}
