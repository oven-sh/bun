// The programs of host-classes that are mostly a table written out: blocks of lines that differ in a few places.
import { programsOf, text } from "../generate";

export const programs = () =>
  programsOf({
    "url-parts-with-a-literal-base.json": text(
      `{
  "skipInShell": "it uses what Bun provides and the jsc shell does not: URL, URLSearchParams"
}
`,
    ),
    "url-parts-with-a-literal-base.ts": text(
      `// new URL(x, base) with the base written as a literal: plain ones, which the build judges, and ones that are not plain or do not parse: what pathname, search and two parameters read, or what is thrown, for inputs of every kind.
const inputs: string[] = ["/", "/text", "/users/42/posts/hello-world?page=2&limit=10&sort=top", "/a?page=1&page=2", "/a?page=%31#page=3", "/a/./b", "/a/../b", "/%2e/b", "//other.com/a?page=4", "/\\\\other.com", "", "a", "a/b?page=5", "?page=6", "#page=7", "http://other.com/c?page=8", "https://other.com:8443/c", "HTTP://OTHER.com/c", "mailto:a@b", "/\\u00e9?page=\\u00e9", "/\\u4e16?page=\\u4e16", "/a b?page=a b", "/a\\tb", " /a ", "/a?page=a+b&limit=%zz"];
const lines: string[] = [];
function tell(base: string, read: (text: string) => unknown): void {
  for (const text of inputs) {
    let said: string;
    try {
      said = JSON.stringify(read(text));
    } catch (error) {
      said = (error as Error).constructor.name + " " + (error as { code?: string }).code;
    }
    lines.push(JSON.stringify(base) + " " + JSON.stringify(text) + " " + said);
  }
}
tell("http://127.0.0.1", text => {
  const url = new URL(text, "http://127.0.0.1");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("http://127.0.0.1", text => new URL(text, "http://127.0.0.1").pathname);
tell("http://localhost:3000", text => {
  const url = new URL(text, "http://localhost:3000");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("http://localhost:3000", text => new URL(text, "http://localhost:3000").pathname);
tell("https://example.com/", text => {
  const url = new URL(text, "https://example.com/");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("https://example.com/", text => new URL(text, "https://example.com/").pathname);
tell("http://example.com/a/b?c=d#e", text => {
  const url = new URL(text, "http://example.com/a/b?c=d#e");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("http://example.com/a/b?c=d#e", text => new URL(text, "http://example.com/a/b?c=d#e").pathname);
tell("http://a.com/\\u00e9", text => {
  const url = new URL(text, "http://a.com/\\u00e9");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("http://a.com/\\u00e9", text => new URL(text, "http://a.com/\\u00e9").pathname);
tell("http://a.com/\\u4e16\\u754c\\ud83d\\ude00", text => {
  const url = new URL(text, "http://a.com/\\u4e16\\u754c\\ud83d\\ude00");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("http://a.com/\\u4e16\\u754c\\ud83d\\ude00", text => new URL(text, "http://a.com/\\u4e16\\u754c\\ud83d\\ude00").pathname);
tell("http://a-b.c0.example:65535", text => {
  const url = new URL(text, "http://a-b.c0.example:65535");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("http://a-b.c0.example:65535", text => new URL(text, "http://a-b.c0.example:65535").pathname);
tell("HTTP://example.com", text => {
  const url = new URL(text, "HTTP://example.com");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("HTTP://example.com", text => new URL(text, "HTTP://example.com").pathname);
tell("http://EXAMPLE.com", text => {
  const url = new URL(text, "http://EXAMPLE.com");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("http://EXAMPLE.com", text => new URL(text, "http://EXAMPLE.com").pathname);
tell("http://ex\\u00e4mple.com", text => {
  const url = new URL(text, "http://ex\\u00e4mple.com");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("http://ex\\u00e4mple.com", text => new URL(text, "http://ex\\u00e4mple.com").pathname);`,
      [
        `http://127.1	http://127.1", text => new URL(text, "http://127.1	http://0x7f.1	http://0x7f.1", text => new URL(text, "http://0x7f.1
http://256.1.1.1	http://256.1.1.1", text => new URL(text, "http://256.1.1.1	http://example.com:65536	http://example.com:65536", text => new URL(text, "http://example.com:65536
http://example.com:	http://example.com:", text => new URL(text, "http://example.com:	http://user@example.com	http://user@example.com", text => new URL(text, "http://user@example.com
http://[::1]	http://[::1]", text => new URL(text, "http://[::1]	http://xn--a.com	http://xn--a.com", text => new URL(text, "http://xn--a.com
http://a..b	http://a..b", text => new URL(text, "http://a..b	http://-a.com	http://-a.com", text => new URL(text, "http://-a.com
http://a_b.com	http://a_b.com", text => new URL(text, "http://a_b.com	http:/example.com	http:/example.com", text => new URL(text, "http:/example.com
http:example.com	http:example.com", text => new URL(text, "http:example.com	http://	http://", text => new URL(text, "http://
ftp://example.com	ftp://example.com", text => new URL(text, "ftp://example.com	file:///a/b	file:///a/b", text => new URL(text, "file:///a/b
nothing	nothing", text => new URL(text, "nothing	/	/", text => new URL(text, "/
	", text => new URL(text, "	about:blank	about:blank", text => new URL(text, "about:blank
data:text/plain,x	data:text/plain,x", text => new URL(text, "data:text/plain,x	ws://example.com	ws://example.com", text => new URL(text, "ws://example.com
https://example.com\\\\a	https://example.com\\\\a", text => new URL(text, "https://example.com\\\\a	 http://example.com	 http://example.com", text => new URL(text, " http://example.com
http://example.com 	http://example.com ", text => new URL(text, "http://example.com 	http://exam\\tple.com	http://exam\\tple.com", text => new URL(text, "http://exam\\tple.com`,
        (n, a, b, c, d) => `tell("${a}", text => {
  const url = new URL(text, "${a}");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("${b}").pathname);
tell("${c}", text => {
  const url = new URL(text, "${c}");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("${d}").pathname);`,
      ],
      `console.log(lines.join("\\n"));
`,
    ),
  });
