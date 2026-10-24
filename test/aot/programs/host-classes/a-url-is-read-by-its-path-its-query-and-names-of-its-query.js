// A URL of which only the path, the query and names of the query are read: hosts, ports, paths, queries and bases of every kind, each answer as the URL object gives it.
// STATISTIC: URLsLeftUnbuilt >= 3
const hosts = ["h", "localhost", "localhost:3000", "a.b", "a-b.c", "a--b.c", "ab--c.d", "xn--a.b", "a.b.", "a..b", "-a.b", "a-.b", "1.2.3.4", "1.2.3", "01.2.3.4", "1.2.3.4.5", "256.1.1.1", "0.0.0.0", "a.1", "a.1b", "1a.b", "0x7f.1", "h:80", "h:443", "h:0", "h:00080", "h:65535", "h:65536", "h:", "H", "u@h", "u:p@h", "[::1]", "h%41", "a_b", "a b", ""];
const paths = ["", "/", "/a", "/a/b", "/a//b", "/.", "/..", "/a/.", "/a/..", "/a/./b", "/a/../b", "/a/.b", "/a/b.", "/a/b..", "/a/%2e", "/a/%2E%2e/b", "/a/b%2e", "/a%2fb", "/a%", "/a%zz", "/a b", "/a\tb", "/a\nb", "/a\\b", "/\\b", "//b", "/a|b", "/a^b", "/a`b", "/a{b}", "/a[b]", "/a'b", "/a\"b", "/a<b>", "/a:b@c;d=e$f&g!h(i)j*k+l,m-n~o_p", "/é", "/一", "/a\u0000b", "/a\u007fb"];
const tails = ["", "?", "?a", "?a=", "?a=1", "?=1", "?a=1&b=2", "?b=2&a=1", "?a=1&a=2", "?&a=1", "?a=1&", "?&&a=1&&", "?a=1=2", "?a==", "?a+=1", "?a=1+2", "?a=%31", "?%61=1", "?b=%zz&a=1", "?b+c=1&a=1", "?a=1#f", "?#f", "#f", "#?a=1", "?a=1#a=2", "?a=1?a=2", "?a=/:@", "?a='", "?a=\"", "?a=<", "?a= ", "?a=\t1", "?a=[1]", "?a=|", "?a=é", "?aa=1", "?A=1", "?a=1 ", "?a=1#\t"];
function parts(text) {
  try {
    const url = new URL(text);
    return url.pathname + " | " + url.search + " | " + url.searchParams.get("a") + " | " + url.searchParams.has("a") + " | " + url.searchParams.get("") + " | " + url.searchParams.has("b");
  } catch (error) { return error.constructor.name; }
}
function partsOn(text, base) {
  try {
    const url = new URL(text, base);
    return url.pathname + " | " + url.search + " | " + url.searchParams.get("a");
  } catch (error) { return error.constructor.name; }
}
function partsOnFixed(text) {
  try {
    const url = new URL(text, "http://localhost");
    return url.pathname + " | " + url.search + " | " + url.searchParams.get("a");
  } catch (error) { return error.constructor.name; }
}
let lines = 0, sum = 0;
function say(label, answer) { lines++; console.log(JSON.stringify(label), JSON.stringify(answer)); }
for (const scheme of ["http://", "https://", "HTTP://", "http:/", "http:", "ws://", "file://", " http://"])
  for (const host of hosts) say(scheme + host + "/p?a=1", parts(scheme + host + "/p?a=1"));
for (const path of paths) for (const tail of tails) say(path + tail, parts("http://h" + path + tail));
for (const path of paths) for (const tail of ["", "?a=1", "#f"]) {
  say("fixed " + path + tail, partsOnFixed(path + tail));
  for (const base of ["http://h", "http://h/x/y", "http://h/x/y?z=1", "http://h:80#f", "http://H", "file:///x", "about:blank", "nope"]) say(base + " + " + path + tail, partsOn(path + tail, base));
}
for (const text of ["a", "a/b", "?a=1", "#f", "", ".", "..", "./a", "../a", "http://o/p?a=3", "https://o/p", "//o/p", "http:p", "http:/p"]) { say("fixed " + text, partsOnFixed(text)); say("based " + text, partsOn(text, "http://h/x/y?a=9")); }
const long = "/" + "x".repeat(4070);
for (const extra of ["", "y", "yy", "yyyyyyyyyyyyyyyyyyyy", "?a=1", "yyyyyyyyyy?a=1"]) { const answer = parts("http://h" + long + extra); say("long " + extra, answer.length + answer.slice(-30)); }
for (const host of ["h".repeat(110), "h".repeat(119), "h".repeat(120), "h".repeat(121), "h".repeat(130)]) { const answer = parts("http://" + host + "/p?a=1"); say("host " + host.length, answer); }
for (const name of [1, null, undefined, "a", "é", "一", { toString() { return "a"; } }, "a" + String.fromCharCode(0)]) {
  const url = new URL("http://h/p?a=1&1=2&null=3&undefined=4&%C3%A9=5");
  say("name " + String(name), String(url.searchParams.get(name)) + url.searchParams.has(name));
}
