const idl = require("internal/desktop/web/idl");
const mime = require("internal/desktop/web/mime");
const network = require("internal/desktop/web/fetch");

const { expose, internal, need, scope } = idl;
const { Request, Response } = network;

const ask = (method: string, ...args: unknown[]) =>
  idl.adopt((async () => scope.env.caches(method, ...args))(), it => it);
const toRequest = (given: unknown) => (given instanceof Request ? given : new Request(given));
const describe = (request: any) => ({
  url: request.url,
  method: request.method,
  headers: network.partsOf(request)[1].pairs,
});

function toOptions(given: unknown) {
  const { ignoreMethod, ignoreSearch, ignoreVary } = idl.dictionary(given);
  return { ignoreMethod: !!ignoreMethod, ignoreSearch: !!ignoreSearch, ignoreVary: !!ignoreVary };
}

function requireStorable(request: any) {
  if (!request.url.startsWith("http") || request.method !== "GET")
    throw new TypeError("Only GET requests of HTTP(S) can be stored.");
}

async function entryOf(request: any, response: any) {
  const { list, ...about } = network.responseParts(response);
  if (about.status === 206) throw new TypeError("Partial response (status code 206) is unsupported");
  if (mime.split(list.get("vary") ?? "").includes("*")) throw new TypeError("Vary header contains *");
  const hasBody = response.body !== null;
  const bytes = await (Response.prototype as any).bytes.$call(response);
  return { request: describe(request), response: { ...about, headers: list.pairs }, body: hasBody ? bytes : null };
}

class Cache {
  #id: number;

  constructor(key: unknown = undefined, id = 0) {
    idl.illegal(key);
    this.#id = id;
  }

  async #find(what: string, given: unknown, init: unknown): Promise<any[]> {
    const request = given === undefined ? given : toRequest(given);
    const options = toOptions(init);
    if (request && request.method !== "GET" && !options.ignoreMethod) return [];
    return ask(what, this.#id, request && describe(request), options);
  }

  async match(request: unknown, options: unknown = undefined) {
    need(arguments.length, 1);
    const [found] = await this.#find("responses", request ?? "undefined", options);
    return found && network.restoreResponse(found);
  }

  async matchAll(request: unknown = undefined, options: unknown = undefined) {
    return Object.freeze(Array.from(await this.#find("responses", request, options), network.restoreResponse));
  }

  async #addAll(given: unknown[]) {
    const requests = given.map(toRequest);
    requests.forEach(requireStorable);
    const entries = requests.map(async request => {
      const response = await network.send(request, "fetch");
      if (!response.ok) throw new TypeError("Request failed");
      return entryOf(request, response);
    });
    await ask("put", this.#id, await Promise.all(entries));
  }

  async add(request: unknown) {
    need(arguments.length, 1);
    return this.#addAll([request]);
  }

  async addAll(requests: unknown) {
    return this.#addAll(idl.sequence(requests));
  }

  async put(given: unknown, response: unknown) {
    const id = this.#id;
    if (!(response instanceof Response)) throw new TypeError("parameter 2 is not of type 'Response'.");
    const request = toRequest(given);
    requireStorable(request);
    await ask("put", id, [await entryOf(request, response)]);
  }

  async delete(request: unknown, options: unknown = undefined) {
    need(arguments.length, 1);
    return (await this.#find("remove", request ?? "undefined", options)) === (true as any);
  }

  async keys(request: unknown = undefined, options: unknown = undefined) {
    const found = await this.#find("requests", request, options);
    return Object.freeze(Array.from(found, network.restoreRequest));
  }
}
expose(Cache);

class CacheStorage {
  constructor(key: unknown = undefined) {
    idl.illegal(key);
  }

  #ask(method: string, name?: string) {
    if (scope.env.origin === "null") throw idl.error("SecurityError", "Cache storage is disabled in this context.");
    return ask(method, name);
  }

  async match(request: unknown, options: unknown = undefined) {
    need(arguments.length, 1);
    const { cacheName } = idl.dictionary(options);
    for (const name of cacheName === undefined ? await this.#ask("names") : [`${cacheName}`]) {
      const id = await this.#ask("idOf", name);
      const found =
        id === undefined ? id : await Cache.prototype.match.$call(new Cache(internal, id), request, options);
      if (found) return found;
    }
  }
  async has(name: string) {
    need(arguments.length, 1);
    return (await this.#ask("idOf", `${name}`)) !== undefined;
  }
  async open(name: string) {
    need(arguments.length, 1);
    return new Cache(internal, await this.#ask("open", `${name}`));
  }
  async delete(name: string) {
    need(arguments.length, 1);
    return this.#ask("discard", `${name}`);
  }
  async keys() {
    return [...(await this.#ask("names"))];
  }
}
expose(CacheStorage);

export default { Cache, CacheStorage };
