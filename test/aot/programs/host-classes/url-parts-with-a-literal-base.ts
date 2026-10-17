// new URL(x, base) with the base written as a literal: plain ones, which the build judges, and ones that are not plain or do not parse: what pathname, search and two parameters read, or what is thrown, for inputs of every kind.
const inputs: string[] = ["/", "/text", "/users/42/posts/hello-world?page=2&limit=10&sort=top", "/a?page=1&page=2", "/a?page=%31#page=3", "/a/./b", "/a/../b", "/%2e/b", "//other.com/a?page=4", "/\\other.com", "", "a", "a/b?page=5", "?page=6", "#page=7", "http://other.com/c?page=8", "https://other.com:8443/c", "HTTP://OTHER.com/c", "mailto:a@b", "/\u00e9?page=\u00e9", "/\u4e16?page=\u4e16", "/a b?page=a b", "/a\tb", " /a ", "/a?page=a+b&limit=%zz"];
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
tell("http://a.com/\u00e9", text => {
  const url = new URL(text, "http://a.com/\u00e9");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("http://a.com/\u00e9", text => new URL(text, "http://a.com/\u00e9").pathname);
tell("http://a.com/\u4e16\u754c\ud83d\ude00", text => {
  const url = new URL(text, "http://a.com/\u4e16\u754c\ud83d\ude00");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("http://a.com/\u4e16\u754c\ud83d\ude00", text => new URL(text, "http://a.com/\u4e16\u754c\ud83d\ude00").pathname);
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
tell("http://ex\u00e4mple.com", text => {
  const url = new URL(text, "http://ex\u00e4mple.com");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("http://ex\u00e4mple.com", text => new URL(text, "http://ex\u00e4mple.com").pathname);
tell("http://127.1", text => {
  const url = new URL(text, "http://127.1");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("http://127.1", text => new URL(text, "http://127.1").pathname);
tell("http://0x7f.1", text => {
  const url = new URL(text, "http://0x7f.1");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("http://0x7f.1", text => new URL(text, "http://0x7f.1").pathname);
tell("http://256.1.1.1", text => {
  const url = new URL(text, "http://256.1.1.1");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("http://256.1.1.1", text => new URL(text, "http://256.1.1.1").pathname);
tell("http://example.com:65536", text => {
  const url = new URL(text, "http://example.com:65536");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("http://example.com:65536", text => new URL(text, "http://example.com:65536").pathname);
tell("http://example.com:", text => {
  const url = new URL(text, "http://example.com:");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("http://example.com:", text => new URL(text, "http://example.com:").pathname);
tell("http://user@example.com", text => {
  const url = new URL(text, "http://user@example.com");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("http://user@example.com", text => new URL(text, "http://user@example.com").pathname);
tell("http://[::1]", text => {
  const url = new URL(text, "http://[::1]");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("http://[::1]", text => new URL(text, "http://[::1]").pathname);
tell("http://xn--a.com", text => {
  const url = new URL(text, "http://xn--a.com");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("http://xn--a.com", text => new URL(text, "http://xn--a.com").pathname);
tell("http://a..b", text => {
  const url = new URL(text, "http://a..b");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("http://a..b", text => new URL(text, "http://a..b").pathname);
tell("http://-a.com", text => {
  const url = new URL(text, "http://-a.com");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("http://-a.com", text => new URL(text, "http://-a.com").pathname);
tell("http://a_b.com", text => {
  const url = new URL(text, "http://a_b.com");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("http://a_b.com", text => new URL(text, "http://a_b.com").pathname);
tell("http:/example.com", text => {
  const url = new URL(text, "http:/example.com");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("http:/example.com", text => new URL(text, "http:/example.com").pathname);
tell("http:example.com", text => {
  const url = new URL(text, "http:example.com");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("http:example.com", text => new URL(text, "http:example.com").pathname);
tell("http://", text => {
  const url = new URL(text, "http://");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("http://", text => new URL(text, "http://").pathname);
tell("ftp://example.com", text => {
  const url = new URL(text, "ftp://example.com");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("ftp://example.com", text => new URL(text, "ftp://example.com").pathname);
tell("file:///a/b", text => {
  const url = new URL(text, "file:///a/b");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("file:///a/b", text => new URL(text, "file:///a/b").pathname);
tell("nothing", text => {
  const url = new URL(text, "nothing");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("nothing", text => new URL(text, "nothing").pathname);
tell("/", text => {
  const url = new URL(text, "/");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("/", text => new URL(text, "/").pathname);
tell("", text => {
  const url = new URL(text, "");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("", text => new URL(text, "").pathname);
tell("about:blank", text => {
  const url = new URL(text, "about:blank");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("about:blank", text => new URL(text, "about:blank").pathname);
tell("data:text/plain,x", text => {
  const url = new URL(text, "data:text/plain,x");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("data:text/plain,x", text => new URL(text, "data:text/plain,x").pathname);
tell("ws://example.com", text => {
  const url = new URL(text, "ws://example.com");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("ws://example.com", text => new URL(text, "ws://example.com").pathname);
tell("https://example.com\\a", text => {
  const url = new URL(text, "https://example.com\\a");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("https://example.com\\a", text => new URL(text, "https://example.com\\a").pathname);
tell(" http://example.com", text => {
  const url = new URL(text, " http://example.com");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell(" http://example.com", text => new URL(text, " http://example.com").pathname);
tell("http://example.com ", text => {
  const url = new URL(text, "http://example.com ");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("http://example.com ", text => new URL(text, "http://example.com ").pathname);
tell("http://exam\tple.com", text => {
  const url = new URL(text, "http://exam\tple.com");
  const query = url.searchParams;
  return [url.pathname, url.search, query.get("page"), query.has("limit")];
});
tell("http://exam\tple.com", text => new URL(text, "http://exam\tple.com").pathname);
console.log(lines.join("\n"));
