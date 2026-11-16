// https://httpwg.org/specs/rfc9111.html, for one user. A response is a file: a line of JSON, and the body.
const fs = require("node:fs");
const path = require("node:path");
const { split } = require("internal/desktop/web/mime");

type Entry = {
  key: string;
  status: number;
  statusText: string;
  headers: [string, string][];
  /** The headers of the request that the response varies by. */
  varies: [string, string | null][];
  requestedAt: number;
  receivedAt: number;
  body: Uint8Array;
};
type Send = (headers: Headers) => Promise<Response> | Response;

const MAX_BODY = 16 << 20;
const MAX_ON_DISK = 256 << 20;
const MAX_IN_MEMORY = 32 << 20;
const cachedByDefault = [200, 203, 204, 300, 301, 308, 404, 405, 410, 414, 501];
const notUpdated =
  /^(?:content-(?:encoding|length|location|md5|range|type)|etag|transfer-encoding|connection|keep-alive)$/;

function directives(header: string | null) {
  const found: Record<string, string> = { __proto__: null as any };
  for (const directive of split(header ?? "")) {
    const [name, value = ""] = directive.split("=");
    found[name.toLowerCase()] ??= value.replaceAll('"', "");
  }
  return found;
}

const seconds = (text: string | null | undefined) => (/^\d+$/.test(text!) ? +text! : undefined);
const dateOf = (text: string | null) => (/^[a-z]{3}/i.test(text!) ? Date.parse(text!) / 1000 : NaN);

/** For how many more seconds it is fresh. */
function freshness(entry: Entry, headers: Headers, control: Record<string, string>) {
  const date = dateOf(headers.get("date")) || entry.receivedAt;
  let lifetime = 0;
  if ("no-cache" in control || headers.get("pragma") === "no-cache") return -Infinity;
  if ("max-age" in control) lifetime = seconds(control["max-age"]) ?? 0;
  else if (headers.has("expires")) lifetime = dateOf(headers.get("expires")) - date || 0;
  else if ([300, 301, 308, 410].includes(entry.status)) lifetime = Infinity;
  else if (cachedByDefault.includes(entry.status) || "public" in control) {
    if (!("must-revalidate" in control)) lifetime = (date - dateOf(headers.get("last-modified"))) / 10 || 0;
  }
  const corrected = (seconds(split(headers.get("age") ?? "")[0]) ?? 0) + entry.receivedAt - entry.requestedAt;
  return lifetime - Math.max(entry.receivedAt - date, corrected) - (Date.now() / 1000 - entry.receivedAt);
}

function respond({ status, statusText, headers, body }: Entry, fromCache: string) {
  return Object.assign(new Response(status === 204 ? null : (body as any), { status, statusText, headers }), {
    fromCache,
  });
}

class HttpCache {
  #directory: string | null;
  #memory = new Map<string, Entry>();
  #writing = new Map<string, Promise<unknown>>();
  #size = 0;
  /** The files that may be there. */
  #names: Promise<Set<string>> | undefined;
  #written = MAX_ON_DISK;

  constructor(directory: string | null) {
    this.#directory = directory && path.join(directory, "Cache");
  }

  #file(key: string) {
    return path.join(this.#directory, Bun.hash(key).toString(36));
  }

  #onDisk() {
    return (this.#names ??= fs.promises
      .readdir(this.#directory as any)
      .catch(() => [])
      .then(names => new Set(names.map(name => path.join(this.#directory, name)))));
  }

  async #read(key: string): Promise<Entry | undefined> {
    await this.#writing.$get(key);
    if (this.#directory === null) return this.#memory.$get(key);
    if (!(await this.#onDisk()).$has(this.#file(key))) return;
    try {
      const bytes = (await fs.promises.readFile(this.#file(key), undefined)) as Buffer;
      const end = bytes.indexOf(10);
      const entry = JSON.parse(bytes.utf8Slice(0, end));
      if (entry.key === key) return { ...entry, body: bytes.subarray(end + 1) };
    } catch {}
  }

  #track(key: string, writing: Promise<unknown>) {
    const done: Promise<unknown> = writing
      .catch(() => {})
      .then(() => this.#writing.$get(key) === done && this.#writing.$delete(key));
    this.#writing.$set(key, done);
  }

  async #write(entry: Entry) {
    const { body, ...about } = entry;
    if (this.#directory === null) {
      await this.#remove(entry.key);
      this.#memory.$set(entry.key, entry);
      this.#size += body.length;
      for (const key of this.#memory.$keys()) if (this.#size > MAX_IN_MEMORY) await this.#remove(key);
      return;
    }
    if ((this.#written += body.length) > MAX_ON_DISK / 8) await this.#trim();
    const file = this.#file(entry.key);
    await fs.promises.writeFile(file + "~", Buffer.concat([Buffer.from(JSON.stringify(about) + "\n"), body]), {
      mode: 0o600,
    });
    await fs.promises.rename(file + "~", file);
    (await this.#onDisk()).$add(file);
  }

  async #remove(key: string) {
    if (this.#directory !== null) {
      const file = this.#file(key);
      return (await this.#onDisk()).$delete(file) && fs.promises.rm(file, { force: true });
    }
    this.#size -= this.#memory.$get(key)?.body.length ?? 0;
    this.#memory.$delete(key);
  }

  async #files(): Promise<{ file: string; size: number; mtimeMs: number }[]> {
    const names = await fs.promises.readdir(this.#directory as any).catch(() => []);
    const describe = async (file: string) => ({
      size: 0,
      mtimeMs: 0,
      ...(await fs.promises.stat(file).catch(() => {})),
      file,
    });
    return Promise.all(names.map(name => describe(path.join(this.#directory, name))));
  }

  async #trim() {
    this.#written = 0;
    await fs.promises.mkdir(this.#directory as any, { recursive: true, mode: 0o700 });
    let size = 0;
    for (const it of (await this.#files()).sort((a, b) => b.mtimeMs - a.mtimeMs)) {
      if ((size += it.size) > MAX_ON_DISK) await fs.promises.rm(it.file, { force: true });
    }
  }

  async size() {
    return this.#directory === null ? this.#size : (await this.#files()).reduce((sum, it) => sum + it.size, 0);
  }

  async clear() {
    await Promise.all(this.#writing.values());
    this.#memory.$clear();
    this.#size = 0;
    this.#written = MAX_ON_DISK;
    if (this.#directory !== null) await fs.promises.rm(this.#directory, { recursive: true, force: true });
  }

  /** Stores the body when whoever asked has read all of it. */
  #keep(key: string, asked: Headers, requestedAt: number, response: Response) {
    const { status, statusText, headers } = response;
    const control = directives(headers.get("cache-control"));
    const names: string[] = split(headers.get("vary") ?? "").filter(Boolean);
    const entry: Entry = {
      key,
      status,
      statusText,
      headers: [...headers].filter(([name]) => name !== "set-cookie"),
      varies: names.map(name => [name, name === "*" ? null : asked.get(name)]),
      requestedAt,
      receivedAt: Date.now() / 1000,
      body: new Uint8Array(),
    };
    const isUseful =
      headers.has("etag") ||
      headers.has("last-modified") ||
      freshness(entry, headers, control) + (seconds(control["stale-while-revalidate"]) ?? 0) > 0;
    const isTooLong = +headers.get("content-length")! > MAX_BODY;
    if (!isUseful || isTooLong || "no-store" in control || names.includes("*") || status === 206 || status === 304) {
      this.#track(key, this.#remove(key));
      return response;
    }
    const { body } = response;
    if (!body || (status >= 300 && status < 400)) {
      this.#track(key, this.#write(entry));
      return response;
    }
    let chunks: Uint8Array[] | undefined = [];
    let length = 0;
    const copying = new TransformStream({
      transform(chunk, controller) {
        if ((length += chunk.length) > MAX_BODY) chunks = undefined;
        chunks?.push(chunk.slice());
        controller.enqueue(chunk);
      },
      flush: () => void (chunks && this.#track(key, this.#write({ ...entry, body: Buffer.concat(chunks) }))),
    });
    return new Response((body as any).pipeThrough(copying), { status, statusText, headers });
  }

  /** `mode` is the `cache` of a `Request`. Undefined if only the cache may be asked, and it has nothing. */
  async exchange(partition: string, url: URL, method: string, headers: Headers, mode = "default", send: Send) {
    const keyOf = (href: string) => `${partition}\n${href.split("#")[0]}`;
    const key = keyOf(url.href);
    if (method !== "GET") {
      const response = await send(headers);
      if (method === "HEAD" || method === "OPTIONS" || response.status >= 400) return response;
      for (const href of [url.href, response.headers.get("location"), response.headers.get("content-location")]) {
        const target = href !== null && URL.parse(href, url.href);
        if (target && target.origin === url.origin) this.#track(keyOf(target.href), this.#remove(keyOf(target.href)));
      }
      return response;
    }
    const isConditional = [...headers.keys()].some(name => name.startsWith("if-"));
    if (mode === "default" && isConditional) mode = "no-store";
    const asked = directives(headers.get("cache-control"));
    const setDefault = (name: string, value: string) => headers.has(name) || headers.set(name, value);
    if (mode === "no-cache") setDefault("cache-control", "max-age=0");
    if (mode === "no-store" || mode === "reload") {
      setDefault("pragma", "no-cache");
      setDefault("cache-control", "no-cache");
    }
    if (mode === "no-store" || "no-store" in asked || headers.has("range")) return send(headers);

    let entry = mode === "reload" || "no-cache" in asked ? undefined : await this.#read(key);
    if (entry?.varies.some(([name, value]) => headers.get(name) !== value)) entry = undefined;
    const requestedAt = Date.now() / 1000;
    if (!entry)
      return mode === "only-if-cached" ? undefined : this.#keep(key, headers, requestedAt, await send(headers));
    if (mode === "force-cache" || mode === "only-if-cached") return respond(entry, "local");

    const stored = new Headers(entry.headers);
    const control = directives(stored.get("cache-control"));
    const left = mode === "no-cache" || asked["max-age"] === "0" ? -Infinity : freshness(entry, stored, control);
    if (left > 0) return respond(entry, "local");
    const validate = async () => {
      const conditional = new Headers(headers);
      if (stored.has("etag")) conditional.set("if-none-match", stored.get("etag")!);
      if (stored.has("last-modified")) conditional.set("if-modified-since", stored.get("last-modified")!);
      const response = await send(conditional);
      if (response.status !== 304) return this.#keep(key, headers, requestedAt, response);
      for (const [name, value] of response.headers) if (!notUpdated.test(name)) stored.set(name, value);
      const updated = { ...entry, headers: [...stored], requestedAt, receivedAt: Date.now() / 1000 };
      this.#track(key, this.#write({ ...updated, headers: updated.headers.filter(([name]) => name !== "set-cookie") }));
      return respond(updated, "validated");
    };
    if (left + (seconds(control["stale-while-revalidate"]) ?? 0) <= 0) return validate();
    validate()
      .then(response => response.arrayBuffer())
      .catch(() => {});
    return respond(entry, "local");
  }
}

export default { HttpCache };
