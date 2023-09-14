import { escapeHTML } from "bun";

export function table(headers: unknown[], rows: unknown[][]): string {
  return (
    "<table>" +
    headers.reduce((html, header) => html + `<th>${header}</th>`, "<tr>") +
    "</tr>" +
    rows.reduce((html, row) => html + row.reduce((html, cell) => html + `<td>${cell}</td>`, "<tr>") + "</tr>", "") +
    "</table>"
  );
}

export function h(level: number, content: string): string {
  return `<h${level}>${content}</h${level}>`;
}

export function ul(items: unknown[]): string {
  return items.reduce((html, item) => html + `<li>${item}</li>`, "<ul>") + "</ul>";
}

export function a(content: string, baseUrl?: string, url?: string): string {
  const href = baseUrl && url ? new URL(url, baseUrl).toString() : baseUrl;
  return href ? `<a href="${href}">${escape(content)}</a>` : escape(content);
}

export function br(n: number = 1): string {
  return "<br/>".repeat(n);
}

export function details(summary: string, details: string): string {
  return `<details><summary>${summary}</summary>${details}</details>`;
}

export function code(content: string, lang: string = ""): string {
  return `<pre lang="${lang}"><code>${escape(content)}</code></pre>`;
}

export function escape(content: string): string {
  return escapeHTML(content).replace(/\+/g, "&#43;").replace(/\-/g, "&#45;").replace(/\*/g, "&#42;");
}

export function percent(numerator: number, demonimator: number): number {
  const percent = Math.floor((numerator / demonimator) * 100);
  if (isNaN(percent) || percent < 0) {
    return 0;
  }
  if (percent >= 100) {
    return numerator >= demonimator ? 100 : 99;
  }
  return percent;
}

export function count(n: number): string {
  return n ? `${n}` : "";
}

export function duration(milliseconds: number): string {
  if (milliseconds === 0) {
    return "";
  }
  if (milliseconds < 1000) {
    return `${Math.ceil(milliseconds)} ms`;
  }
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  let result = [];
  if (hours) {
    result.push(`${hours}h`);
  }
  if (minutes) {
    result.push(`${minutes % 60}m`);
  }
  if (seconds) {
    result.push(`${seconds % 60}s`);
  }
  return result.join(" ");
}
