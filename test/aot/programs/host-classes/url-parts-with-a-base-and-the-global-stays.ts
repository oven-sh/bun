// `new URL(x, base)` that is only read for pathname, search or a search parameter is compiled without allocating the URL, as `new URL(x)` is. For any input and any base the results and errors are those of plain Bun. Here nothing ever replaces the global, so the compiler knows the constructor.
// STATISTIC: URLsLeftUnbuilt >= 8
const lines: string[] = [];
function say(label: string, work: () => unknown) {
  let text: string;
  try {
    text = JSON.stringify(work()) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name + ": " + (error as Error).message;
  }
  lines.push(label + ": " + text);
}

function pathnameOf(text: string, base: string) {
  return new URL(text, base).pathname;
}
function searchOf(text: string, base: string) {
  return new URL(text, base).search;
}
function parameterOf(text: string, base: string, name: string) {
  return new URL(text, base).searchParams.get(name);
}
function hasParameter(text: string, base: string, name: string) {
  return new URL(text, base).searchParams.has(name);
}
function threeParameters(text: string, base: string) {
  const query = new URL(text, base).searchParams;
  return [query.get("page"), query.get("limit"), query.get("sort"), query.has("a")];
}
function partsOf(text: string, base: string) {
  const url = new URL(text, base);
  return [url.pathname, url.search, url.searchParams.get("a"), url.searchParams.has("b")];
}
function partsThroughTwoNames(text: string, base: string) {
  const url = new URL(text, base);
  const query = url.searchParams;
  return [url.pathname, query.get("a"), query.get("")];
}
function partsReadInClosure(text: string, base: string) {
  const url = new URL(text, base);
  const ask = () => url.pathname + url.search;
  return ask() + ask();
}
function pathnameOfAnything(text: any, base: any) {
  return new URL(text, base).pathname;
}
function partsOfAnything(text: any, base: any) {
  const url = new URL(text, base);
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("a"), query.has("b")];
}
function withConstantBase(text: string | undefined) {
  const url = new URL(text ?? "/", "http://127.0.0.1");
  const parts = url.pathname.split("/");
  const query = url.searchParams;
  return [url.pathname === "/text", parts.length, parts[1], query.get("page"), query.get("limit"), query.get("sort")];
}
async function inAnAsyncFunction(text: string) {
  const url = new URL(text, "http://localhost:3000");
  const before = url.pathname;
  await null;
  return [before, url.pathname, url.search, url.searchParams.get("a")];
}

let seed = 11;
const random = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff), seed / 0x7fffffff);
const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
const choose = <T,>(usual: readonly T[], odd: readonly T[]): T => (random() < 0.93 ? pick(usual) : pick(odd));
const usualBases = ["http://127.0.0.1", "http://localhost", "http://localhost:3000", "https://example.com", "https://example.com/", "http://example.com/a/b", "http://example.com/a/b?c=d", "http://a-b.c:80#e", "https://x:443?y", "http://a"];
const oddBases = ["", "/", "nothing", "HTTP://example.com", "http:/example.com", "http:example.com", "http://", "https://", "ftp://example.com", "file:///a/b", "file:///C:/a", "data:text/plain,a", "mailto:a@b.c", "about:blank", "http://user:word@example.com", "http://example.com@other.com", "http://EXAMPLE.com", "http://1.2.3", "http://256.1.1.1", "http://0x7f.1", "http://[::1]", "http://[::1]:80/a", "http://example.com:", "http://example.com:99999", "http://example.com:8a", "http://exa mple.com", "http://example.com\\a", " http://example.com", "http://example.com ", "http://exam\tple.com", "http://é.com", "http://xn--a.com", "http://a..b", "http://-a.b", "http://a-.b", "http://example.com/a b", "http://example.com/é", "http://example.com/\ud800", "null", "undefined", "blob:http://example.com/a"];
const usualStarts = ["/", "/", "/", "/", "/users", "/a/b"];
const oddStarts = ["", "a", "a/b", "./a", "../a", ".", "..", "//", "//other.com", "//other.com/a?b=c", "/\\other.com", "\\", "\\\\other.com/a", "?", "?a=1", "#", "#a", "http://other.com/a?a=9", "https://other.com", "http:/a", "http:a", "https:a", "ftp://other.com/a", "mailto:a", " /a", "\t/a", "/\ta", "\n/a", "é", "/é"];
const usualPieces = ["/", "/", "/", "a", "b", "users", "42", "%41", "%zz", "+", ";", ":", "@", "~", "!", "$", "&", "(", ")", "*", ",", "=", "-", "_", "a.b"];
const oddPieces = [".", "..", "/.", "/..", "/./", "/../", "%2e", "/%2e", "/%2E%2e", "/.%2e", " ", "\t", "\n", "\\", "'", "[", "]", "^", "`", "{", "|", "}", "\"", "<", ">", "é", "\u{1F600}", "\ud800"];
const usualQuery = ["a", "b", "page", "limit", "sort", "=", "=", "&", "&", "1", "20", "new", "?", "/", ":", "@", "a=1", "a=", "=1", "&&", "a=1&a=2", "page=2&limit=10&sort=old"];
const oddQuery = ["%20", "+", "%", "%zz", "%41", "%61", "%C3%A9", "%ff", "'", "\"", "<", ">", " ", "é", "[", "]", "{", "}", "|", "^", "`", "\\", "\t"];
const pairs: [string, string][] = [
  ["/users/42/posts/hello-world?page=2&limit=10&sort=top", "http://127.0.0.1"],
  ["/text", "http://127.0.0.1"],
  ["/", "http://127.0.0.1"],
  ["/?", "http://a"],
  ["/#", "http://a"],
  ["/?#", "http://a"],
  ["/a?b#c?d", "http://a"],
  ["/a#b?c=d", "http://a"],
];
for (const base of [...usualBases, ...oddBases]) pairs.push(["/a/b?a=1&b=2", base], ["http://other.com/c?a=3", base], ["c?a=4", base]);
for (const start of [...usualStarts, ...oddStarts]) pairs.push([start, "http://example.com/x/y?z=1"], [start + "?a=1", "http://127.0.0.1"]);
for (let turn = 0; turn < 260; turn++) {
  let text = choose(usualStarts, oddStarts);
  for (let n = Math.floor(random() * 5); n > 0; n--) text += choose(usualPieces, oddPieces);
  if (random() < 0.7) {
    text += "?";
    for (let n = Math.floor(random() * 7); n > 0; n--) text += choose(usualQuery, oddQuery);
  }
  if (random() < 0.15) text += "#" + choose(usualPieces, oddPieces);
  pairs.push([text, choose(usualBases, oddBases)]);
}
for (const [text, base] of pairs) {
  const shown = JSON.stringify(text) + " on " + JSON.stringify(base);
  say(shown + " pathname", () => pathnameOf(text, base));
  say(shown + " search", () => searchOf(text, base));
  for (const name of ["a", "page", "", "a b", "é", "A"]) say(shown + " get " + JSON.stringify(name), () => [parameterOf(text, base, name), hasParameter(text, base, name)]);
  say(shown + " three", () => threeParameters(text, base));
  say(shown + " parts", () => partsOf(text, base));
  say(shown + " two names", () => partsThroughTwoNames(text, base));
  say(shown + " later", () => partsReadInClosure(text, base));
}
for (const text of [undefined, "/text", "/json", "/users/42/posts/hello-world?page=2&limit=10&sort=top", "/async/42", "//text", "/a/../text", "text", "/text?page=%31", "/text?page=1+2", "*"]) say("a constant base, " + JSON.stringify(text), () => withConstantBase(text));
const joined = ["/us", "ers/7?a", "=1&b=2"];
say("an input that was joined", () => partsOf(joined[0] + joined[1] + joined[2], "http://" + ["exam", "ple.com"].join("")));
say("an input that is a part of another", () => partsOf("GET /users/7?a=1&b=2 HTTP/1.1".slice(4, 22), "see http://example.com here".slice(4, 22)));

const plain = "/a/b?a=1&b=2";
const root = "http://example.com";
const order: string[] = [];
say("an input that is not a string", () => new URL({ toString: () => (order.push("text"), plain) } as any, root).pathname);
say("a base that is not a string", () => new URL(plain, { toString: () => (order.push("base"), root) } as any).pathname);
say("neither is a string", () => new URL({ toString: () => (order.push("text"), plain) } as any, { toString: () => (order.push("base"), root) } as any).search);
say("a name that is not a string", () => new URL(plain, root).searchParams.get({ toString: () => (order.push("name"), "b") } as any));
say("the order of conversions", () => order);
say("a base that is a URL", () => partsOfAnything(plain, new URL("http://example.com/x")));
say("a base that is undefined", () => [pathnameOfAnything("http://example.com/a", undefined), partsOfAnything("http://example.com/a?a=1", undefined), (() => { try { return pathnameOfAnything(plain, undefined); } catch (error) { return (error as Error).constructor.name; } })()]);
say("a base that is null, a number, a boolean", () => [null, 5, true].map(base => { try { return pathnameOfAnything(plain, base); } catch (error) { return (error as Error).constructor.name; } }));
say("an input that is null, a number, a boolean, undefined", () => [null, 5, true, undefined].map(text => partsOfAnything(text, root)));
say("a base that is a symbol", () => pathnameOfAnything(plain, Symbol.iterator));
say("a base that throws", () =>
  pathnameOfAnything(plain, {
    toString() {
      throw new RangeError("no base");
    },
  }),
);
say("operands are evaluated in their order", () => {
  const seen: string[] = [];
  new URL((seen.push("text"), plain), (seen.push("base"), root)).searchParams.get((seen.push("name"), "a"));
  return seen;
});
say("an invalid base throws before the name is evaluated", () => {
  const seen: string[] = [];
  try {
    new URL(plain, "nothing").searchParams.get((seen.push("name"), "a"));
  } catch {
    seen.push("thrown");
  }
  return seen;
});
say("an invalid base throws though the input stands alone", () => pathnameOf("http://example.com/a", "nothing"));
say("the error for an invalid base", () => {
  try {
    return new URL(plain, "nothing").pathname;
  } catch (error) {
    return [(error as { code?: string }).code, (error as { input?: string }).input, (error as { base?: string }).base, error instanceof TypeError, Object.keys(error as object)];
  }
});
say("the error for an invalid input", () => {
  try {
    return new URL("http://", root).pathname;
  } catch (error) {
    return [(error as { code?: string }).code, (error as { input?: string }).input, (error as { base?: string }).base, error instanceof TypeError, Object.keys(error as object)];
  }
});
say("three arguments", () => new (URL as unknown as new (...all: string[]) => URL)(plain, root, "http://other.com").pathname);
say("a spread", () => {
  const both: [string, string] = [plain, root];
  return new URL(...both).pathname;
});

const kept: unknown[] = [];
say("a URL that escapes into an array", () => {
  const url = new URL(plain, root);
  kept.push(url);
  return [url.pathname, url instanceof URL, kept[0] === url, url.href];
});
say("a URL whose properties are assigned", () => {
  const url = new URL(plain, root);
  url.pathname = "/other";
  url.search = "?c=3";
  return [url.pathname, url.search, url.searchParams.get("c"), url.href];
});
say("search parameters that are changed", () => {
  const url = new URL(plain, root);
  const query = url.searchParams;
  query.set("a", "changed");
  return [query.get("a"), url.search];
});
say("other members", () => {
  const url = new URL(plain, "http://example.com:8080/x");
  return [url.pathname, url.href, url.origin, url.host, url.hash, String(url), JSON.stringify(url)];
});

class Subclass extends URL {
  override get pathname() {
    return "subclass of " + super.pathname;
  }
}
say("a subclass", () => new Subclass(plain, root).pathname);
say("a local class named URL", () => {
  class URL {
    pathname: string;
    constructor(text: string, base: string) {
      this.pathname = "local " + text.length + " " + base.length;
    }
  }
  return new URL(plain, root).pathname;
});
console.log(lines.join("\n"));
