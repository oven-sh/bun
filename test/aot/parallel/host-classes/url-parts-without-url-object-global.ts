// `new URL(x)` that is only read for pathname, search or a search parameter is compiled without allocating the URL. For any input the results and errors are those of plain Bun, also where the object escapes and where `URL` is another class. Here nothing ever replaces the global, so the compiler knows the constructor.
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

function pathnameOf(text: string) {
  return new URL(text).pathname;
}
function searchOf(text: string) {
  return new URL(text).search;
}
function parameterOf(text: string, name: string) {
  return new URL(text).searchParams.get(name);
}
function hasParameter(text: string, name: string) {
  return new URL(text).searchParams.has(name);
}
function threeParameters(text: string) {
  const query = new URL(text).searchParams;
  return [query.get("page"), query.get("limit"), query.get("sort"), query.has("a")];
}
function partsOf(text: string) {
  const url = new URL(text);
  return [url.pathname, url.search, url.searchParams.get("a"), url.searchParams.has("b")];
}
function partsThroughTwoNames(text: string) {
  const url = new URL(text);
  const query = url.searchParams;
  return [url.pathname, query.get("a"), query.get("")];
}
function partsReadInClosure(text: string) {
  const url = new URL(text);
  const ask = () => url.pathname + url.search;
  return ask() + ask();
}

let seed = 7;
const random = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff), seed / 0x7fffffff);
const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
const choose = <T,>(usual: readonly T[], odd: readonly T[]): T => (random() < 0.93 ? pick(usual) : pick(odd));
const usualHeads = ["http://example.com", "https://example.com", "http://localhost:3000", "http://127.0.0.1:8080", "https://api.example.co.uk", "http://a-b.c:80", "https://x:443"];
const oddHeads = ["HTTP://example.com", "http:/example.com", "http:example.com", "ftp://example.com", "file:///a", "http://user:word@example.com", "http://EXAMPLE.com", "http://1.2.3", "http://256.1.1.1", "http://01.2.3.4", "http://0x7f.1", "http://a..b", "http://.a", "http://a.", "http://-a.b", "http://xn--a.b", "http://xn--nxasmq6b", "http://[::1]", "http://a_b.c", "http://é.com", "http://", "http://1", "http://a.1", "http://a:65536", "http://a:", "http://a:08", "http://a:8a", " http://a", "http://a b", "about:blank", "", "/only/a/path", "http://a%2eb"];
const usualPieces = ["/", "/", "/", "a", "b", "users", "42", "%41", "%zz", "+", ";", ":", "@", "~", "!", "$", "&", "(", ")", "*", ",", "=", "-", "_", "a.b"];
const oddPieces = [".", "..", "/.", "/..", "/./", "/../", "%2e", "/%2e", "/%2E%2e", "/.%2e", " ", "\t", "\n", "\\", "'", "[", "]", "^", "`", "{", "|", "}", "\"", "<", ">", "é", "\u{1F600}", "\ud800"];
const usualQuery = ["a", "b", "page", "limit", "sort", "=", "=", "&", "&", "1", "20", "new", "?", "/", ":", "@", "a=1", "a=", "=1", "&&", "a=1&a=2", "page=2&limit=10&sort=old"];
const oddQuery = ["%20", "+", "%", "%zz", "%41", "%61", "%C3%A9", "%ff", "'", "\"", "<", ">", " ", "é", "[", "]", "{", "}", "|", "^", "`", "\\", "\t"];
const texts: string[] = ["http://example.com/users/7/posts/9?page=2&limit=10&sort=old", "http://example.com", "http://example.com?a=1", "http://example.com#a", "http://example.com/?", "http://example.com/?#", "http://example.com/a?a=1#b?a=2"];
for (let turn = 0; turn < 260; turn++) {
  let text = choose(usualHeads, oddHeads);
  if (random() < 0.95) text += "/";
  for (let n = Math.floor(random() * 5); n > 0; n--) text += choose(usualPieces, oddPieces);
  if (random() < 0.7) {
    text += "?";
    for (let n = Math.floor(random() * 7); n > 0; n--) text += choose(usualQuery, oddQuery);
  }
  if (random() < 0.15) text += "#" + choose(usualPieces, oddPieces);
  texts.push(text);
}
for (const text of texts) {
  const shown = JSON.stringify(text);
  say(shown + " pathname", () => pathnameOf(text));
  say(shown + " search", () => searchOf(text));
  for (const name of ["a", "page", "", "a b", "é", "A"]) say(shown + " get " + JSON.stringify(name), () => [parameterOf(text, name), hasParameter(text, name)]);
  say(shown + " three", () => threeParameters(text));
  say(shown + " parts", () => partsOf(text));
  say(shown + " two names", () => partsThroughTwoNames(text));
  say(shown + " later", () => partsReadInClosure(text));
}

const plain = "http://example.com/a/b?a=1&b=2";
const order: string[] = [];
say("an input that is not a string", () => new URL({ toString: () => (order.push("text"), plain) } as any).pathname);
say("a name that is not a string", () => new URL(plain).searchParams.get({ toString: () => (order.push("name"), "b") } as any));
say("a name that is a number, null, undefined", () => [5, null, undefined].map(name => new URL("http://a/?5=five&null=none&undefined=nothing").searchParams.get(name as any)));
say("a name that throws", () =>
  new URL(plain).searchParams.get({
    toString() {
      throw new RangeError("no name");
    },
  } as any),
);
say("a symbol for a name", () => new URL(plain).searchParams.get(Symbol.iterator as any));
say("the order of conversions", () => order);
say("the input is evaluated before the name", () => {
  const seen: string[] = [];
  new URL((seen.push("text"), plain)).searchParams.get((seen.push("name"), "a"));
  return seen;
});
say("an invalid input throws before the name is evaluated", () => {
  const seen: string[] = [];
  try {
    new URL("nothing").searchParams.get((seen.push("name"), "a"));
  } catch {
    seen.push("thrown");
  }
  return seen;
});
say("the error for an invalid input", () => {
  try {
    return new URL("nothing").pathname;
  } catch (error) {
    return [(error as { code?: string }).code, (error as { input?: string }).input, error instanceof TypeError, Object.keys(error as object)];
  }
});

const kept: unknown[] = [];
say("a URL that escapes into an array", () => {
  const url = new URL(plain);
  kept.push(url);
  return [url.pathname, url instanceof URL, kept[0] === url];
});
say("a URL that is returned", () => {
  const make = () => {
    const url = new URL(plain);
    void url.pathname;
    return url;
  };
  return [make().href, make() instanceof URL];
});
say("a URL whose properties are assigned", () => {
  const url = new URL(plain);
  url.pathname = "/other";
  url.search = "?c=3";
  return [url.pathname, url.search, url.searchParams.get("c"), url.href];
});
say("search parameters that are changed", () => {
  const url = new URL(plain);
  const query = url.searchParams;
  query.set("a", "changed");
  query.append("c", "3");
  return [query.get("a"), url.search, query.get("c")];
});
say("searchParams is the same object each time", () => {
  const url = new URL(plain);
  return url.searchParams === url.searchParams;
});
say("other members", () => {
  const url = new URL(plain);
  return [url.pathname, url.href, url.origin, url.host, url.hash, String(url), JSON.stringify(url)];
});
say("a missing member", () => {
  const url = new URL(plain);
  return [url.pathname, (url as unknown as { nothing: unknown }).nothing];
});
say("get without a name, and with two", () => {
  const query = new URL(plain).searchParams;
  return [(query.get as (...names: string[]) => unknown)("a", "b"), (query.has as (...names: string[]) => unknown)("a", "2")];
});
say("get without arguments", () => (new URL(plain).searchParams.get as () => unknown)());
say("the method is read and called later", () => {
  const query = new URL(plain).searchParams;
  const get = query.get;
  return get.call(query, "a");
});
say("a base", () => new URL("/c?d=4", plain).searchParams.get("d"));
say("a let", () => {
  let url = new URL(plain);
  const first = url.pathname;
  url = new URL("http://example.com/second");
  return [first, url.pathname];
});
say("read before it is initialized", () => {
  const ask = () => url.pathname;
  const early = (() => {
    try {
      return ask();
    } catch (error) {
      return (error as Error).constructor.name;
    }
  })();
  const url = new URL(plain);
  return [early, ask()];
});
say("optional chains", () => {
  const url = new URL(plain);
  return [url?.pathname, url.searchParams?.get("a"), url.searchParams.get?.("b")];
});

class Subclass extends URL {
  override get pathname() {
    return "subclass of " + super.pathname;
  }
}
say("a subclass", () => new Subclass(plain).pathname);
say("a local class named URL", () => {
  class URL {
    pathname: string;
    searchParams = { get: (name: string) => "local " + name };
    constructor(text: string) {
      this.pathname = "local " + text.length;
    }
  }
  return [new URL(plain).pathname, new URL(plain).searchParams.get("a")];
});
console.log(lines.join("\n"));
