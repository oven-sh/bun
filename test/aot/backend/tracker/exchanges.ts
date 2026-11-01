// The requests that the test and the benchmark send, and a program that sends them.
//
//   bun exchanges.ts compare <name>=<port> <name>=<port> ..      every request to every server: do they answer alike?
//   bun exchanges.ts write <folder> <port>                       <folder>/<set>.json for measure/measure.py: each request with its answer
//
// DATABASE_URL names a database that schema.sql has filled: the requests are drawn from its rows. The set "writes" changes the
// database, so to compare, every server needs a copy of its own (CREATE DATABASE .. TEMPLATE ..), and `write` leaves that set out.
import { SQL } from "bun";

export interface Exchange {
  set: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string | null;
  /** Send the cookie that this server set when it answered the last sign-in. */
  signedIn?: boolean;
  /** The answer holds a number or a time of its own: the benchmark's client checks its length alone. */
  varies?: boolean;
}

interface ProjectRow {
  id: number;
  slug: string;
  issues: number;
}

interface TagRow {
  id: number;
  updated: number;
  comments: number;
}

function md5(text: string): string {
  return new Bun.CryptoHasher("md5").update(text).digest("hex");
}

/** The cookie of one of the thousand sessions that schema.sql makes. Every hundredth has expired. */
export function sessionToken(user: number): string {
  return md5(`session ${user}`) + md5(`more of session ${user}`);
}

export function csrfToken(user: number): string {
  return md5(`csrf ${user}`);
}

/** Numbers that look drawn at random and are the same in every run. */
function generator(seed: number): (below: number) => number {
  return below => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) % below;
  };
}

/** The project whose issues the benchmark comments on. An answer that shows one of them does not stay the same. */
let quietSlug = "";

const labelNames = ["bug", "feature", "docs", "performance", "question", "regression", "good first issue", "help wanted"];

export async function makeExchanges(sql: SQL): Promise<Exchange[]> {
  const projects = await sql<ProjectRow[]>`SELECT id, slug, next_number - 1 AS issues FROM projects ORDER BY id`;
  // The benchmark comments on the issues of one project of middling size, which no other set reads.
  const quiet = projects.filter(project => project.issues > 0)[9]!;
  quietSlug = quiet.slug;
  const busy = projects.filter(project => project.issues > 0 && project !== quiet);
  const total = busy.reduce((sum, project) => sum + project.issues, 0);
  const exchanges: Exchange[] = [];
  const get = (set: string, path: string, headers: Record<string, string> = {}) => exchanges.push({ set, method: "GET", path, headers, body: null });
  const cookie = (user: number) => ({ Cookie: `sid=${sessionToken(user)}` });
  const bearer = (user: number) => ({ Authorization: `Bearer ${sessionToken(user)}` });
  const form = (set: string, path: string, user: number | null, fields: Record<string, string | string[]>, csrf = user === null ? null : csrfToken(user)) => {
    const params = new URLSearchParams();
    if (csrf !== null) params.set("csrf", csrf);
    for (const [name, value] of Object.entries(fields)) for (const one of [value].flat()) params.append(name, one);
    exchanges.push({
      set,
      method: "POST",
      path,
      headers: { ...(user === null ? {} : cookie(user)), "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
  };
  const api = (set: string, method: string, path: string, user: number | null, body: unknown) =>
    exchanges.push({
      set,
      method,
      path,
      headers: { ...(user === null ? {} : bearer(user)), "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  // An issue drawn evenly from all issues, so a project is visited as often as it is large.
  const draw = (random: (below: number) => number): { slug: string; number: number; issues: number } => {
    let n = random(total);
    for (const project of busy) {
      if (n < project.issues) return { slug: project.slug, number: n + 1, issues: project.issues };
      n -= project.issues;
    }
    throw new Error("unreachable");
  };
  // Who reads. The sessions from 600 on write (the sets "comment", "api-comment" and "mix"), and nobody reads what they write.
  const user = (random: (below: number) => number) => {
    const n = 1 + random(598);
    return n % 100 === 0 ? n + 1 : n;
  };

  let random = generator(1);
  for (let k = 0; k < 400; k++) {
    const { slug, number } = draw(random);
    get("issue", `/p/${slug}/issues/${number}`, cookie(user(random)));
    get("api-issue", `/api/projects/${slug}/issues/${number}`);
  }

  random = generator(2);
  for (let k = 0; k < 240; k++) {
    const { slug, issues } = draw(random);
    const params = new URLSearchParams();
    const closed = random(100) < 35;
    if (closed) params.set("state", "closed");
    const filtered = random(100) < 30;
    if (filtered) params.set("label", labelNames[random(labelNames.length)]!);
    const sort = random(100);
    if (sort < 15) params.set("sort", "created");
    else if (sort < 25) params.set("sort", "comments");
    const pages = Math.max(1, Math.floor((issues * (closed ? 0.6 : 0.36) * (filtered ? 0.1 : 1)) / 25));
    const turn = random(100);
    if (turn < 30) params.set("page", String(Math.min(pages, 2 + random(2))));
    else if (turn < 45) params.set("page", String(1 + random(pages)));
    const query = params.toString();
    get("list", `/p/${slug}/issues${query && `?${query}`}`, cookie(user(random)));
    params.set("per_page", "100");
    params.delete("page");
    get("api-list", `/api/projects/${slug}/issues?${params}`);
  }

  const words = ["server", "timeout", "deadlock", "crash", "cache", "parser", "session", "upload", "regression", "heap", "router", "fails", "leaks", "stale"];
  // Most searches name something rare, a build or a host, and some only words that half of all issues hold.
  const rare = await sql<{ build: string; host: string }[]>`
    SELECT substring(body FROM 'build (b[0-9]+) on') AS build, substring(body FROM 'host (h[0-9]+)\\.') AS host FROM issues WHERE id % 250 = 3 ORDER BY id`;
  random = generator(3);
  for (let k = 0; k < 120; k++) {
    const { build, host } = rare[k % rare.length]!;
    const kind = random(100);
    const q =
      kind < 30
        ? build
        : kind < 60
          ? host
          : kind < 90
            ? `${host} ${words[random(words.length)]}`
            : Array.from({ length: 3 }, () => words[random(words.length)]).join(" ");
    const params = new URLSearchParams({ q });
    if (kind >= 30 && random(100) < 20) params.set("page", "2");
    get("search", `/search?${params}`, cookie(user(random)));
    get("api-search", `/api/search?${params}`);
  }

  const logins = await sql<{ login: string }[]>`SELECT login FROM users ORDER BY id`;
  random = generator(4);
  for (let k = 0; k < 200; k++) {
    const drawn = Math.floor((random(5000) * random(5000)) / 5000);
    const { login } = logins[drawn >= 599 && drawn < 1000 ? drawn + 400 : drawn]!;
    get("profile", `/u/${login}`, cookie(user(random)));
    get("api-user", `/api/users/${login}`);
  }

  for (let k = 0; k < 20; k++) get("home", "/", cookie(user(random)));
  get("api-projects", "/api/projects");
  get("admin", "/admin", cookie(1));
  get("admin", "/api/admin/stats", bearer(2));

  random = generator(5);
  for (let k = 0; k < 396; k++) {
    const writer = 601 + k + Math.floor(k / 99);
    const text = `Seen here as well, on **${words[random(words.length)]}** ${k}.\r\n\r\n- \`${words[random(words.length)]}.${words[random(words.length)]}()\` ${words[random(words.length)]}\r\n- see #${1 + random(quiet.issues)}`;
    form("comment", `/p/${quiet.slug}/issues/${1 + random(quiet.issues)}/comments`, writer, { body: text });
    api("api-comment", "POST", `/api/projects/${quiet.slug}/issues/${1 + random(quiet.issues)}/comments`, writer, { body: text.replaceAll("\r\n", "\n") });
    exchanges.at(-1)!.varies = true;
  }

  // What a day's traffic might look like: of 1,000 requests, so many of each set.
  const shares: [string, number][] = [
    ["issue", 330],
    ["list", 200],
    ["home", 50],
    ["profile", 80],
    ["search", 30],
    ["api-issue", 120],
    ["api-list", 80],
    ["api-user", 50],
    ["api-search", 20],
    ["comment", 30],
    ["api-comment", 10],
  ];
  random = generator(6);
  const mix: Exchange[] = [];
  for (const [set, count] of shares) {
    const members = exchanges.filter(exchange => exchange.set === set);
    for (let k = 0; k < count; k++) mix.push({ ...members[k % members.length]!, set: "mix" });
  }
  for (let k = mix.length - 1; k > 0; k--) {
    const other = random(k + 1);
    [mix[k], mix[other]] = [mix[other]!, mix[k]!];
  }
  exchanges.push(...mix);

  // What is rare: nobody signed in, sessions that are over or never were, what is not there, odd parameters, conditional requests.
  const first = busy[0]!;
  const empty = projects.find(project => project.issues === 0);
  get("edge", `/p/${first.slug}/issues`);
  get("edge", `/p/${first.slug}/issues/1`);
  get("edge", `/p/${first.slug}/issues/1`, cookie(100));
  get("edge", `/p/${first.slug}/issues/1`, { Cookie: "sid=nobody" });
  get("edge", `/p/${first.slug}/issues/1`, { Cookie: `theme=dark; sid=${sessionToken(3)}; other=1` });
  get("edge", `/p/${first.slug}/issues/2?reply_to=7`, cookie(1));
  get("edge", `/p/${first.slug}/issues/2?reply_to=x`, cookie(1));
  if (empty) get("edge", `/p/${empty.slug}/issues`, cookie(2));
  if (empty) get("edge", `/api/projects/${empty.slug}/issues`);
  for (const path of ["/nothing", "/p/none/issues", "/p/none/issues/1", `/p/${first.slug}/issues/0`, `/p/${first.slug}/issues/999999`])
    get("edge", path, cookie(2));
  for (const number of ["abc", "1x", "01", "-1", "1.5", "99999999999", "%31"]) {
    get("edge", `/p/${first.slug}/issues/${number}`);
    get("edge", `/api/projects/${first.slug}/issues/${number}`);
  }
  for (const path of ["/api/nothing", "/api/projects/none/issues", "/api/projects/none/issues/1"]) get("edge", path);
  for (const query of [
    "page=0",
    "page=-3",
    "page=abc",
    "page=2x",
    "page=+2",
    "page=%202",
    "page=99999",
    "page=999999999999999999999",
    "page=",
    "state=all",
    "state=closed&state=open",
    "sort=none",
    "label=",
    "label=nothing",
    "label=good+first+issue",
    "label=good%20first%20issue&sort=comments&state=closed",
    "label=%3Cb%3E%22%27%26~*!()",
    "label=%E5%B1%B1",
    "per_page=3",
    "per_page=0",
    "per_page=1000",
  ]) {
    get("edge", `/p/${first.slug}/issues?${query}`, cookie(4));
    get("edge", `/api/projects/${first.slug}/issues?${query}`);
  }
  const [tag] = await sql<TagRow[]>`
    SELECT i.id, (extract(epoch FROM i.updated_at) * 1000)::float8 AS updated, i.comment_count AS comments
    FROM issues i WHERE i.project_id = ${first.id} AND i.number = 3`;
  if (tag) {
    get("edge", `/p/${first.slug}/issues/3`, { ...cookie(5), "If-None-Match": `"${tag.id}-${tag.updated}-${tag.comments}-5"` });
    get("edge", `/p/${first.slug}/issues/3`, { ...cookie(6), "If-None-Match": `"${tag.id}-${tag.updated}-${tag.comments}-5"` });
    get("edge", `/api/projects/${first.slug}/issues/3`, { "If-None-Match": `"${tag.id}-${tag.updated}-${tag.comments}"` });
    get("edge", `/api/projects/${first.slug}/issues/3`, { "If-None-Match": `"other"` });
  }
  const second = busy[1]!;
  const [mine] = await sql<{ number: number; author: number }[]>`
    SELECT number, author_id AS author FROM issues WHERE project_id = ${first.id} AND author_id BETWEEN 6 AND 99 ORDER BY id LIMIT 1`;
  get("edge", "/");
  get("edge", "/", cookie(1));
  get("edge", "/login");
  get("edge", "/login", cookie(9));
  get("edge", "/admin");
  get("edge", "/admin", cookie(9));
  get("edge", "/api/admin/stats");
  get("edge", "/api/admin/stats", bearer(9));
  get("edge", "/api/admin/stats", bearer(100));
  get("edge", "/api/admin/stats", { Authorization: "Basic abc" });
  get("edge", "/assets/app.css");
  get("edge", "/assets/app.css", { "If-None-Match": `"nothing"` });
  get("edge", "/search");
  get("edge", "/search?q=");
  get("edge", "/search?q=%20%20");
  get("edge", "/search?q=nothingmatchesthis", cookie(3));
  get("edge", "/search?q=%3Cb%3E+%22crash%22+-heap+or+%26", cookie(3));
  get("edge", "/search?q=Crash+HEAP&page=3");
  get("edge", "/search?q=server&page=1000");
  get("edge", "/api/search");
  get("edge", "/api/search?q=nothingmatchesthis");
  get("edge", "/u/nobody", cookie(3));
  get("edge", "/u/" + logins[4999]!.login);
  get("edge", "/u/" + logins[96]!.login);
  get("edge", "/api/users/nobody");
  get("edge", `/p/${first.slug}/issues/new`);
  get("edge", `/p/${first.slug}/issues/new`, cookie(3));
  get("edge", "/p/none/issues/new", cookie(3));
  get("edge", `/p/${first.slug}/issues/1/edit`);
  get("edge", `/p/${first.slug}/issues/1/edit`, cookie(1));
  get("edge", `/p/${first.slug}/issues/1/edit`, cookie(999));
  get("edge", `/p/${first.slug}/issues/0/edit`, cookie(1));
  if (mine) get("edge", `/p/${first.slug}/issues/${mine.number}/edit`, cookie(mine.author));
  for (const path of ["/", "/logout", "/search", `/p/${first.slug}/issues/1`, `/p/${first.slug}/issues/1/comments`, "/api/projects", `/api/projects/${first.slug}/issues/1`])
    exchanges.push({ set: "edge", method: "DELETE", path, headers: {}, body: null });
  get("edge", "/logout");
  get("edge", `/p/${first.slug}/issues/1/comments`);

  // What changes the database. Every refusal first: it must change nothing.
  const issues = `/p/${second.slug}/issues`;
  const good = { title: "The cache is <stale> after a deploy", body: "## Steps\r\n\r\n1. Deploy\r\n2. Reload & look\r\n\r\nSee #3, cc @nobody-1 🎉", priority: "2", labels: ["bug", "docs"], assignee: "" };
  form("writes", issues, null, good);
  form("writes", issues, 100, good);
  form("writes", issues, 11, good, "wrong");
  form("writes", issues, 11, good, null);
  form("writes", "/p/none/issues", 11, good);
  form("writes", issues, 11, { ...good, title: "   " });
  form("writes", issues, 11, { ...good, title: "x".repeat(201), body: "y".repeat(20001), priority: "7", assignee: "No Such" });
  form("writes", issues, 11, { ...good, title: "山".repeat(200), priority: "" });
  form("writes", issues, 11, { ...good, title: "🎉".repeat(101), priority: "abc" });
  form("writes", issues, 11, { ...good, labels: Array.from({ length: 13 }, (_, k) => `label ${k}`) });
  form("writes", issues, 11, { ...good, labels: ["bug", "", "z".repeat(51)] });
  form("writes", issues, 11, { ...good, assignee: "nobody-at-all" });
  form("writes", issues, 11, {});
  get("writes", issues, cookie(11));
  form("writes", issues, 11, good);
  get("writes", `${issues}/${second.issues + 1}`, cookie(11));
  get("writes", `${issues}/${second.issues + 1}`, cookie(11));
  form("writes", issues, 12, { title: "Second", body: "", priority: "0", assignee: logins[20]!.login, labels: ["nothing like it", "bug"] });
  get("writes", `${issues}/${second.issues + 2}`, cookie(13));
  get("writes", issues, cookie(12));
  get("writes", `${issues}?label=bug&sort=created`, cookie(12));
  get("writes", "/", cookie(14));

  const made = `${issues}/${second.issues + 1}`;
  form("writes", `${made}/comments`, null, { body: "Hello" });
  form("writes", `${made}/comments`, 15, { body: "Hello" }, "wrong");
  form("writes", `${made}/comments`, 15, { body: "  " });
  form("writes", `${made}/comments`, 15, { body: "z".repeat(20001) });
  form("writes", `${made}/comments`, 15, { body: "Hello", parent_id: "1" });
  form("writes", `${made}/comments`, 15, { body: "Hello", parent_id: "abc" });
  form("writes", `${made}/comments`, 15, { body: "Hello", parent_id: "0" });
  form("writes", `${issues}/999999/comments`, 15, { body: "Hello" });
  form("writes", `${made}/comments`, 15, { body: "First **comment**\r\n\r\n- one\r\n- two" });
  form("writes", `${made}/comments`, 16, { body: "A reply to it", parent_id: "347871" });
  form("writes", `${made}/comments`, 11, { body: "The author answers", parent_id: "347872" });
  get("writes", made, cookie(15));
  get("writes", made, cookie(16));
  get("writes", `/api/projects/${second.slug}/issues/${second.issues + 1}`);

  form("writes", made, null, good);
  form("writes", made, 15, { ...good, state: "closed" });
  form("writes", made, 11, { ...good, state: "closed" }, "wrong");
  form("writes", made, 11, { ...good, title: "", state: "closed" });
  form("writes", made, 11, { ...good, priority: "", state: "closed" });
  form("writes", made, 11, { ...good, assignee: "nobody-at-all", state: "closed" });
  form("writes", `${issues}/999999`, 11, good);
  form("writes", made, 11, { title: "Closed now", body: "Done.", priority: "3", labels: ["feature"], assignee: logins[30]!.login, state: "closed" });
  get("writes", made, cookie(11));
  get("writes", `${made}/edit`, cookie(11));
  form("writes", made, 1, { title: "Opened again by an admin", body: "Not done.", priority: "1", state: "open" });
  get("writes", made, cookie(1));
  get("writes", issues, cookie(17));
  get("writes", `${issues}?state=closed`, cookie(17));

  const apiIssues = `/api/projects/${second.slug}/issues`;
  const input = { title: "Made through the API", body: "With `code` & more", priority: 1, labels: ["bug"], assignee: null };
  api("writes", "POST", apiIssues, null, input);
  api("writes", "POST", apiIssues, 100, input);
  api("writes", "POST", "/api/projects/none/issues", 21, input);
  for (const body of [
    "",
    "{",
    "null",
    "[]",
    '"text"',
    "5",
    {},
    { ...input, title: 5 },
    { ...input, title: null },
    { ...input, priority: 1.5 },
    { ...input, priority: "1" },
    { ...input, labels: "bug" },
    { ...input, labels: [1] },
    { ...input, labels: [null] },
    { ...input, labels: null },
    { ...input, assignee: 7 },
    { ...input, title: "" },
    { ...input, title: "x".repeat(201), priority: 4, labels: ["", "ok"], assignee: "Not A Login" },
    { ...input, priority: -1 },
    { ...input, assignee: "nobody-at-all" },
    { ...input, title: "", priority: "1" },
  ])
    api("writes", "POST", apiIssues, 21, body);
  api("writes", "POST", apiIssues, 21, input);
  api("writes", "POST", apiIssues, 22, { title: "No assignee named", body: "", priority: 0, labels: [], more: true });
  api("writes", "POST", apiIssues, 23, { ...input, assignee: logins[40]!.login, labels: ["docs", "bug", "nothing"] });
  const apiMade = `${apiIssues}/${second.issues + 3}`;
  get("writes", apiMade);
  get("writes", `${apiIssues}/${second.issues + 5}`);
  api("writes", "PATCH", apiMade, null, { state: "closed" });
  api("writes", "PATCH", apiMade, 22, { state: "closed" });
  api("writes", "PATCH", `${apiIssues}/999999`, 21, { state: "closed" });
  for (const body of ["", "[]", { state: "all" }, { state: null }, { title: null }, { title: "" }, { priority: 9 }, { labels: [""] }, { assignee: "nobody-at-all" }, { assignee: 1 }])
    api("writes", "PATCH", apiMade, 21, body);
  api("writes", "PATCH", apiMade, 21, {});
  get("writes", apiMade);
  api("writes", "PATCH", apiMade, 21, { state: "closed", assignee: logins[50]!.login });
  get("writes", apiMade);
  api("writes", "PATCH", apiMade, 1, { title: "Renamed", labels: ["docs", "feature"], assignee: null, priority: 3 });
  get("writes", apiMade);
  api("writes", "PATCH", apiMade, 21, { state: "open", body: "Again" });
  get("writes", apiMade);
  api("writes", "POST", `${apiMade}/comments`, null, { body: "Hello" });
  api("writes", "POST", `${apiIssues}/999999/comments`, 24, { body: "Hello" });
  for (const body of ["", "[]", {}, { body: 1 }, { body: "" }, { body: "Hello", parentId: 1 }, { body: "Hello", parentId: 0 }, { body: "Hello", parentId: "1" }])
    api("writes", "POST", `${apiMade}/comments`, 24, body);
  api("writes", "POST", `${apiMade}/comments`, 24, { body: "Through the API" });
  api("writes", "POST", `${apiMade}/comments`, 25, { body: "A reply", parentId: 347874 });
  api("writes", "POST", `${apiMade}/comments`, 26, { body: "No parent", parentId: null });
  get("writes", apiMade);
  get("writes", `/u/${logins[23]!.login}`, cookie(24));
  get("writes", "/api/projects");
  get("writes", "/admin", cookie(1));

  const password = "correct horse battery staple";
  form("writes", "/login", null, { login: logins[1500]!.login, password: "wrong" });
  form("writes", "/login", null, { login: "nobody-at-all", password });
  form("writes", "/login", null, { login: "Not A Login", password });
  form("writes", "/login", null, { login: logins[1500]!.login });
  form("writes", "/login", null, {});
  form("writes", "/login", null, { login: ` ${logins[1500]!.login} `, password });
  exchanges.push({ set: "writes", method: "GET", path: "/", headers: {}, body: null, signedIn: true });
  exchanges.push({ set: "writes", method: "GET", path: "/login", headers: {}, body: null, signedIn: true });
  form("writes", "/logout", null, {});
  form("writes", "/logout", 31, {}, "wrong");
  form("writes", "/logout", 31, {});
  get("writes", "/", cookie(31));
  return exchanges;
}

export interface Answer {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

const comparedHeaders = ["content-type", "location", "etag", "cache-control", "set-cookie"];

const cookies = new Map<number, string>();

/** After the last row that schema.sql makes. What the servers write at this hour differs from one to the next and is masked. */
const seeded = Date.parse("2026-08-01T00:00:00Z");

function masked(text: string): string {
  return text
    .replace(/20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, moment => (Date.parse(moment) > seeded ? "(now)" : moment))
    .replace(/[A-Z][a-z]{2} \d{1,2}, 20\d\d(, \d\d:\d\d)?/g, moment => (Date.parse(`${moment.slice(0, 12).replace(/,\s*$/, "")} UTC`) > seeded ? "(now)" : moment));
}

/** `asItIs`: nothing is masked. */
export async function send(port: number, exchange: Exchange, asItIs = false): Promise<Answer> {
  const response = await fetch(`http://127.0.0.1:${port}${exchange.path}`, {
    method: exchange.method,
    headers: exchange.signedIn ? { ...exchange.headers, Cookie: cookies.get(port) ?? "" } : exchange.headers,
    body: exchange.body,
    redirect: "manual",
  });
  const headers: Record<string, string> = {};
  for (const name of comparedHeaders) {
    const value = response.headers.get(name);
    if (value !== null) headers[name] = name === "content-type" ? value.replace(/\s*;\s*charset=utf-8$/i, "") : value;
  }
  const body = await response.bytes();
  if (asItIs) return { status: response.status, headers, body };
  if (headers.location) headers.location = headers.location.replace(/#comment-\d+$/, exchange.set === "writes" ? "$&" : "#comment-(new)");
  if (exchange.set !== "writes" && !exchange.varies) return { status: response.status, headers, body };

  const token = /^sid=[0-9a-f]{64}/.exec(headers["set-cookie"] ?? "");
  if (token) {
    cookies.set(port, token[0]);
    headers["set-cookie"] = headers["set-cookie"]!.replace(token[0], "sid=(token)");
  }
  if (headers.etag) headers.etag = headers.etag.replace(/-(\d{13})-/, (all, moment) => (Number(moment) > seeded ? "-(now)-" : all));
  let text = masked(new TextDecoder().decode(body));
  if (exchange.varies) text = text.replace(/^\{"id":\d+/, '{"id":(new)');
  if (exchange.signedIn) text = text.replace(/name="csrf" value="[0-9a-f]{32}"/g, 'name="csrf" value="(token)"');
  return { status: response.status, headers, body: new TextEncoder().encode(text) };
}

/** Where two answers part, or nothing. */
export function difference(a: Answer, b: Answer): string | null {
  if (a.status !== b.status) return `status ${a.status} | ${b.status}`;
  if (JSON.stringify(a.headers) !== JSON.stringify(b.headers)) return `headers ${JSON.stringify(a.headers)} | ${JSON.stringify(b.headers)}`;
  const length = Math.min(a.body.length, b.body.length);
  let at = 0;
  while (at < length && a.body[at] === b.body[at]) at++;
  if (at === a.body.length && at === b.body.length) return null;
  const around = (body: Uint8Array) => JSON.stringify(new TextDecoder().decode(body.subarray(Math.max(0, at - 60), at + 60)));
  return `byte ${at} of ${a.body.length} | ${b.body.length}: ${around(a.body)} | ${around(b.body)}`;
}

if (import.meta.main) {
  const [command, ...words] = process.argv.slice(2);
  const sql = new SQL({ url: process.env.DATABASE_URL ?? "postgres://tracker:tracker@127.0.0.1:5432/tracker", max: 1 });
  const exchanges = await makeExchanges(sql);
  await sql.close();

  if (command === "compare") {
    const servers = words.map(word => word.split("=") as [string, string]);
    let differences = 0;
    const sizes = new Map<string, number>();
    for (const exchange of exchanges) {
      const answers: Answer[] = [];
      for (const [, port] of servers) answers.push(await send(Number(port), exchange));
      sizes.set(exchange.set, (sizes.get(exchange.set) ?? 0) + answers[0]!.body.length);
      for (let k = 1; k < servers.length; k++) {
        const parted = difference(answers[0]!, answers[k]!);
        if (parted === null) continue;
        if (++differences <= Number(process.env.SHOW ?? 12))
          console.log(`${servers[0]![0]} | ${servers[k]![0]}: ${exchange.method} ${exchange.path} ${JSON.stringify(exchange.headers).slice(0, 60)}\n    ${parted}`);
      }
    }
    for (const [set, bytes] of sizes) {
      const count = exchanges.filter(exchange => exchange.set === set).length;
      console.log(`${set}: ${count} requests, ${Math.round(bytes / count)} bytes an answer`);
    }
    console.log(`${exchanges.length} requests, ${servers.length} servers, ${differences} differences`);
    process.exit(differences === 0 ? 0 : 1);
  } else if (command === "write") {
    const [folder, port] = words as [string, string];
    const sets = new Map<string, object[]>();
    for (const exchange of exchanges) {
      if (exchange.set === "writes") continue;
      const answer = await send(Number(port), exchange, true);
      const text = new TextDecoder().decode(answer.body);
      if (exchange.method === "GET" && (text.includes(`/p/${quietSlug}/issues/`) || text.includes(`"project":{"slug":"${quietSlug}"`))) continue;
      const list = sets.get(exchange.set) ?? [];
      sets.set(exchange.set, list);
      list.push({
        method: exchange.method,
        path: exchange.path,
        headers: Object.entries(exchange.headers).map(([name, value]) => `${name}: ${value}`),
        body: exchange.body,
        status: answer.status,
        kind: answer.headers["content-type"] ?? "-",
        check: exchange.varies ? "length" : "exact",
        answer: text,
      });
    }
    for (const [set, list] of sets) await Bun.write(`${folder}/${set}.json`, JSON.stringify(list));
    console.log(`${[...sets.keys()].join(" ")} in ${folder}`);
  } else {
    console.error("compare | write");
    process.exit(2);
  }
}
