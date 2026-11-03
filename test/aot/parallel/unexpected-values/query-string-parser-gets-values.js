// A query string parser gets values that are not strings.
function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (ArrayBuffer.isView(value)) return value.constructor.name + "<" + Array.prototype.join.call(value, " ") + ">";
  let text;
  try {
    text = String.prototype.valueOf.call(value);
  } catch {
    const parts = [];
    for (const key of Reflect.ownKeys(value)) parts.push(String(key) + ": " + show(value[key]));
    return "{" + parts.join(", ") + "}";
  }
  return "String object " + JSON.stringify(text);
}

function attempt(label, run) {
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + " -> " + line);
}

function make(text) {
  return (0, eval)("(" + text + ")");
}

function parseQuery(query) {
  var result = {};
  if (query[0] === "?") query = query.slice(1);
  var pairs = query.split("&");
  for (var i = 0; i < pairs.length; i++) {
    var pair = pairs[i];
    if (pair === "") continue;
    var at = pair.indexOf("=");
    var key = at === -1 ? pair : pair.slice(0, at);
    var value = at === -1 ? "" : pair.slice(at + 1);
    key = decodeURIComponent(key.replace(/\+/g, " "));
    value = decodeURIComponent(value.replace(/\+/g, " "));
    if (key in result) result[key] = [].concat(result[key], value);
    else result[key] = value;
  }
  return result;
}

function parseQuerySafely(query) {
  var result = Object.create(null);
  String(query)
    .replace(/^\?/, "")
    .split("&")
    .forEach(function (pair) {
      if (!pair) return;
      var parts = pair.split("=");
      result[decodeURIComponent(parts[0])] = parts.length > 1 ? decodeURIComponent(parts.slice(1).join("=")) : true;
    });
  return result;
}

function buildQuery(values) {
  var parts = [];
  for (var key in values) {
    var value = values[key];
    if (value === undefined) continue;
    if (Array.isArray(value)) for (var i = 0; i < value.length; i++) parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(value[i]));
    else parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(value));
  }
  return parts.join("&");
}

function describe(result) {
  var parts = [];
  Reflect.ownKeys(result).forEach(function (key) {
    parts.push(JSON.stringify(key) + ": " + show(typeof result[key] === "function" ? "a function" : result[key]));
  });
  var prototype = Object.getPrototypeOf(result);
  return "{" + parts.join(", ") + "} prototype " + (prototype === null ? "null" : prototype === Object.prototype ? "Object.prototype" : "other");
}

var total = 0;
for (var i = 0; i < 2000; i++) {
  total += Object.keys(parseQuery("?a=1&b=2&a=3")).length + Object.keys(parseQuerySafely("?a=1&b=2")).length + buildQuery({ a: "1", b: ["2", "3"] }).length;
}
console.log("2000 honest rounds", total);

var queries = [
  "'?a=1&b=2&a=3'",
  "'a=1'",
  "''",
  "'?'",
  "'a'",
  "'a=b=c'",
  "'a+b=c+d&%E4%B8%96=%F0%9F%98%80'",
  "'__proto__=x&constructor=y&toString=z'",
  "'__proto__=x&__proto__=y'",
  "'constructor=a&constructor=b'",
  "'hasOwnProperty=1&length=2&0=zero&1=one&00=padded'",
  "'2=b&1=a&x=c&-1=d'",
  "'a=%'",
  "'%ZZ=1'",
  "'=empty&&=again'",
  "new String('?a=1')",
  "['?', 'a=1']",
  "['a=1&b=2']",
  "{ 0: '?', slice() { return 'x=from+slice'; } }",
  "{ split() { return ['k=v', 5, null]; } }",
  "{ split() { return ['k=v', { indexOf() { return -1; }, replace() { return 'odd'; } }]; } }",
  "{ toString() { return 'from=toString'; } }",
  "5",
  "null",
  "undefined",
  "Buffer.from('a=1')",
];

queries.forEach(function (text) {
  attempt("parse " + text, function () { return describe(parseQuery(make(text))); });
  attempt("parse safely " + text, function () { return describe(parseQuerySafely(make(text))); });
});

var tables = [
  "{ a: '1', b: ['2', '3'] }",
  "{ a: 1, b: [2, null, undefined], c: null, d: undefined, e: true, f: -0, g: 1e21 }",
  "{ 'a b': 'c d', '\\u4e16': '\\ud83d\\ude00', '&=': '?#' }",
  "{ a: '\\ud83d' }",
  "{ a: {} , b: { toString() { return 'x y'; } }, c: [[1, 2]] }",
  "{ a: Symbol('s') }",
  "{ a: 1n, b: new String('w'), c: new Date(0).getTime() }",
  "{ 2: 'b', 1: 'a', x: 'c' }",
  "Object.create({ inherited: 'yes' }, { own: { value: 'too', enumerable: true } })",
  "['x', 'y']",
  "'xy'",
  "new Map([['a', 1]])",
  "null",
  "5",
];
tables.forEach(function (text) {
  attempt("build " + text, function () { return buildQuery(make(text)); });
});

console.log("bytes made in plain sight", Buffer.from("he").length);
