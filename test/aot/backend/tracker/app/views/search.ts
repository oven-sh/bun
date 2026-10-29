import { markedExcerpt } from "../excerpt";
import { formatCount, timeTag } from "../format";
import type { SearchHit } from "../types";
import { pagination } from "./issue-list";
import { escape, userLink } from "./layout";

export function searchUrl(text: string, page: number): string {
  const params = new URLSearchParams({ q: text });
  if (page !== 1) params.set("page", String(page));
  return `/search?${params}`;
}

function hitItem(hit: SearchHit, terms: string[]): string {
  return `<li class="issue ${hit.state}"><a class="title" href="/p/${hit.project.slug}/issues/${hit.number}">${escape(hit.title)}</a>
<p>${markedExcerpt(hit.body, terms)}</p>
<div class="meta"><a href="/p/${hit.project.slug}/issues">${escape(hit.project.name)}</a> #${hit.number} opened ${timeTag(hit.createdAt)} by ${userLink(
    hit.author,
  )}, ${formatCount(hit.commentCount, "comment")}</div></li>`;
}

export function searchView(text: string, terms: string[], hits: SearchHit[], total: number, page: number, perPage: number): string {
  if (text === "") return `<h1>Search</h1>\n<p>Type some words into the box above.</p>`;
  return `<h1>${formatCount(total, "issue")} for “${escape(text)}”</h1>
${hits.length === 0 ? `<p class="empty">Nothing here.</p>` : `<ul class="hits">\n${hits.map(hit => hitItem(hit, terms)).join("\n")}\n</ul>`}
${pagination(page, Math.ceil(total / perPage), page => searchUrl(text, page))}`;
}
