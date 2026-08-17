// new URL() / URL.canParse() / URL.parse() across the URL shapes that show up in real code.
import { bench, group, run } from "../runner.mjs";

const kinds = {
  "origin only": "https://example.com",
  "origin + slash": "https://example.com/",
  "short path": "https://bun.sh/docs/api/http",
  "path + query + hash": "https://example.com/search?q=bun+url+parser&page=2#results",
  "long CDN path":
    "https://cdn.example.com/assets/v3/2024/08/16/9f8e7d6c5b4a/bundle.min.js?integrity=sha384-oqVuAfXRKap7fdgc",
  "GitHub API": "https://api.github.com/repos/oven-sh/bun/pulls?state=open&per_page=100&sort=updated",
  "localhost + port": "http://localhost:3000/api/users/42",
  "credentials + port": "https://user:p%40ss@registry.internal:8443/npm/@scope%2fpkg",
  "IPv4 host": "http://192.168.1.10:8080/metrics",
  "IPv6 host": "http://[2001:db8::8a2e:370:7334]:8080/status",
  "IDN host": "https://日本語.jp/ニュース?ページ=1",
  "percent-encoded": "https://example.com/a%20b/%E6%97%A5%E6%9C%AC?x=%3D%26",
  "needs normalizing": "HTTPS://WWW.Example.COM:443/a/./b/../c/%7efoo",
  "file URL": "file:///home/user/projects/bun/src/main.rs",
  "Windows file URL": "file:///C:/Users/me/AppData/Local/Temp/file.txt",
  "non-special scheme": "git+ssh://git@github.com/oven-sh/bun.git",
  "data: URL": "data:text/plain;base64,SGVsbG8sIFdvcmxkIQ==",
  "very long query (2 KB)":
    "https://example.com/track?" + Array.from({ length: 60 }, (_, i) => `utm_${i}=value_${i}_abcdefghij`).join("&"),
};

const relative = [
  ["relative path", "../assets/logo.svg", "https://example.com/docs/guide/intro.html"],
  ["absolute path", "/api/v1/items?limit=10", "https://example.com/app/index.html"],
  ["query only", "?page=3", "https://example.com/list?page=2#top"],
  ["scheme-relative", "//cdn.example.com/lib.js", "https://example.com/"],
];

const invalid = ["not a url", "http://", "https://exa mple.com/", "http://[::1/", "https://xn--a.com/"];

group("new URL(absolute)", () => {
  for (const [name, input] of Object.entries(kinds)) bench(name, () => new URL(input));
});

group("new URL(relative, base)", () => {
  for (const [name, input, base] of relative) bench(name, () => new URL(input, base));
  const baseURL = new URL("https://example.com/docs/guide/intro.html");
  bench("relative path (URL base)", () => new URL("../assets/logo.svg", baseURL));
});

group("URL.canParse", () => {
  for (const name of [
    "origin + slash",
    "path + query + hash",
    "long CDN path",
    "IPv6 host",
    "IDN host",
    "needs normalizing",
  ])
    bench(name, () => URL.canParse(kinds[name]));
  bench("invalid (5 kinds)", () => {
    let n = 0;
    for (const input of invalid) n += URL.canParse(input);
    return n;
  });
});

group("literal punycode host", () => {
  bench("canParse valid (xn--ls8h.com)", () => URL.canParse("https://xn--ls8h.com/p"));
  bench("canParse invalid (xn--a.com)", () => URL.canParse("https://xn--a.com/p"));
});

group("same string base every call", () => {
  const base = "https://example.com/app/index.html";
  bench("new URL(path, base)", () => new URL("/api/v1/items?limit=10", base));
  bench("URL.parse(path, base)", () => URL.parse("/api/v1/items?limit=10", base));
  bench("URL.canParse(path, base)", () => URL.canParse("/api/v1/items?limit=10", base));
});

group("URL.parse", () => {
  bench("path + query + hash", () => URL.parse(kinds["path + query + hash"]));
  bench("invalid", () => URL.parse("https://exa mple.com/"));
});

group("new URL() + accessors", () => {
  bench("href", () => new URL(kinds["path + query + hash"]).href);
  bench("pathname + search + hash", () => {
    const u = new URL(kinds["path + query + hash"]);
    return u.pathname.length + u.search.length + u.hash.length;
  });
  bench("searchParams.get", () => new URL(kinds["path + query + hash"]).searchParams.get("q"));
  bench("toString()", () => new URL(kinds["GitHub API"]).toString());
});

group("new URL(invalid) throws", () => {
  bench("try/catch", () => {
    try {
      return new URL("https://exa mple.com/");
    } catch {
      return null;
    }
  });
});

await run();
