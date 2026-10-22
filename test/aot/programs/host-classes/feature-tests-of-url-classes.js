// Feature tests that a polyfill (core-js) runs on URL and URLSearchParams when it loads. A test that fails makes the library replace the class or a member of URLSearchParams.prototype, which is locked. Each answers as in plain Bun.
function attempt(label, run) {
  try { console.log(label + ": " + String(run())); } catch (error) { console.log(label + ": " + error.constructor.name); }
}

attempt("parameters deleted while forEach runs", () => {
  const url = new URL("b?a=1&b=2&c=3", "https://a");
  const params = url.searchParams;
  let result = "";
  url.pathname = "c%20d";
  params.forEach((value, key) => { params.delete("b"); result += key + value; });
  return [result, url.href, params.get("c"), params.size, typeof params.sort, typeof params[Symbol.iterator], typeof url.toJSON].join();
});
attempt("delete with a value", () => {
  const params = new URLSearchParams("a=1&a=2&b=3");
  params.delete("a", 2);
  params.delete("b", undefined);
  return [String(params), params.has("a", 1), params.has("a", 2), params.has("a", undefined), params.has("b")].join();
});
attempt("delete with the other value", () => { const params = new URLSearchParams("a=1&a=2&b=3"); params.delete("a", 1); params.delete("b", undefined); return params + ""; });
attempt("has with a value", () => { const params = new URLSearchParams("a=1"); return [params.has("a", 2), params.has("a", undefined), params.has("a", 1), params.has("a")].join(); });
attempt("size", () => ["size" in URLSearchParams.prototype, new URLSearchParams("a=1&a=2&b=3").size, typeof Object.getOwnPropertyDescriptor(URLSearchParams.prototype, "size").get].join());
attempt("texts", () => [
  String(new URLSearchParams("?a=1")), new URL("https://a@b").username, new URLSearchParams(new URLSearchParams("a=b")).get("a"),
  new URL("https://тест").host, new URL("https://a#б").hash, new URL("https://x", undefined).host,
].join());
attempt("parse and canParse", () => [typeof URL.parse, typeof URL.canParse, URL.canParse("https://a"), URL.canParse("a"), URL.canParse("a", "https://b"), URL.parse("a") === null, URL.canParse.length, URL.parse.length].join());
attempt("canParse without an argument", () => URL.canParse());
attempt("toJSON", () => new URL("https://a/b?c#d").toJSON());
attempt("members borrowed", () => {
  const forEach = Function.prototype.call.bind(URLSearchParams.prototype.forEach);
  const getAll = Function.prototype.call.bind(URLSearchParams.prototype.getAll);
  const seen = [];
  forEach(new URLSearchParams("a=1&b=2"), (value, key) => seen.push(key + value));
  return [seen.join("+"), getAll(new URLSearchParams("a=1&a=2"), "a").join("+")].join();
});
attempt("members borrowed for what is no URLSearchParams", () => URLSearchParams.prototype.forEach.call({}, () => {}));
