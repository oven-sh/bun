// A native setter that has been called many times for objects of one shape, so that it is noted, throws for a value it refuses: the error comes out where the store stands, is caught there, and the next store works.
const log = [];
function setHref(url, value) { "use strict"; url.href = value; return url.href; }
function setTitle(value) { "use strict"; process.title = value; return typeof process.title; }
function attempt(what, body) { try { log.push(what + " " + String(body())); } catch (error) { log.push(what + " !" + error.constructor.name + " " + (error instanceof TypeError)); } }
const url = new URL("http://example.com/");
let last = "";
for (let round = 0; round < 300; round++) last = setHref(url, "http://example.com/" + (round & 7));
log.push("noted " + last);
attempt("no URL", () => setHref(url, "::"));
attempt("kept", () => url.href);
attempt("a symbol", () => setHref(url, Symbol("s")));
attempt("an object whose toString throws", () => setHref(url, { toString() { throw new RangeError("thrown"); } }));
attempt("again", () => setHref(url, "http://example.com/again"));
function deep(n) { return n === 0 ? setHref(url, "::") : deep(n - 1) + 1; }
attempt("from ten frames down", () => deep(10));
let caught = 0;
for (let round = 0; round < 200; round++) { try { setHref(url, round & 1 ? "::" : "http://example.com/" + round); } catch { caught++; } }
log.push("caught " + caught + " " + url.href);
function inFinally() { try { return setHref(url, "::"); } finally { log.push("finally"); } }
attempt("through a finally", inFinally);
async function awaited() { await null; try { setHref(url, "::"); } catch (error) { return "async " + error.constructor.name; } }
const title = process.title;
for (let round = 0; round < 300; round++) last = setTitle("title" + (round & 3));
log.push("title " + last);
attempt("the title gets a symbol", () => setTitle(Symbol("s")));
attempt("the title again", () => setTitle(title));
awaited().then(text => {
  log.push(text);
  console.log(log.join("\n"));
});
