// search assigned
let conversions = 0;
const texts: (() => unknown)[] = [
  () => "/a", () => "/a?x=1", () => "/a?x=1&y=2&x=3", () => "/a/b/c/d", () => "/", () => "", () => "?x=1", () => "#frag", () => "/a#frag", () => "/a?x=1#frag",
  () => "/a?x=a%20b", () => "/a?x=a+b", () => "/a?x=%E4%BD%A0", () => "/a?x", () => "/a?x=", () => "/a?=v", () => "/a?&&x=1", () => "/a?x=1&", () => "/a?y=%", () => "/a?x=1;y=2",
  () => "/a b", () => "/a%20b", () => "/\u00e4", () => "/a?x=\u00e4", () => "/a/../b", () => "/a/./b", () => "/a//b", () => "/a/..", () => "/%2e%2e/b", () => "//other/a", () => "http://other.example/a?x=9",
  () => "https://user:pw@h:8080/p?x=1", () => "HTTP://H/UP?x=1", () => "\\a", () => "/a\\b", () => "/a\tb", () => " /a ", () => "/a?x=1\n", () => "http://", () => "http://[", () => ":", () => "a:b", () => "mailto:x@y",
  () => "/a?x=1&x=", () => "/a?xx=1", () => "/a?X=1", () => "/a'b", () => "/a\"b", () => "/a<b>", () => "/a?x=<b>", () => "/a?x='", () => "/a{b}", () => "/a|b", () => "/a^b", () => "/a`b",
  () => "/" + "a".repeat(5000), () => "/a?" + "k=1&".repeat(1200) + "x=7", () => "/a?x=" + "v".repeat(5000), () => "/" + "a".repeat(4094), () => "/" + "a".repeat(4095), () => "/" + "a".repeat(4096),
  () => 5, () => null, () => undefined, () => true, () => 10n, () => ["/a?x=list"], () => new String("/a?x=boxed"), () => new URL("http://h2/a?x=url"),
  () => ({ toString() { conversions++; return "/a?x=object"; } }), () => ({ toString() { conversions++; throw new RangeError("no text"); } }), () => Symbol("s"),
];
const flag = texts.length > 3;
const names: unknown[] = ["x", "y", "", "X", "xx", "k", 5, null, undefined, { toString() { conversions++; return "x"; } }];
let unknownCalls = 0;
const table: Record<string, () => void> = { count() { unknownCalls++; } };
function unknown() { table[flag ? "count" : "none"]!(); }
function taker(url: URL) { return url.href; }
function pause() { return new Promise<void>(resolve => resolve()); }
function shape(text: any): unknown { const url = new URL(text, "http://127.0.0.1"); const before = url.searchParams.get("x"); url.search = "?x=changed"; return [before, url.searchParams.get("x"), url.search]; }

async function main() {
  for (const text of texts) {
    let said: unknown;
    try {
      said = await shape(text());
    } catch (error) {
      said = "threw " + (error as Error).name;
    }
    const line = JSON.stringify(said) ?? String(said);
    console.log(line.length > 120 ? line.length + ":" + line.slice(0, 40) + ".." + line.slice(-40) : line, conversions);
  }
}
await main();
