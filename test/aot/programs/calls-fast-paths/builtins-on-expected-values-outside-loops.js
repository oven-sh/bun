// A call of a built-in on values of unknown type, outside loops. Such calls go to a body that
// all equal calls share. A call of a method in tail position stays in line,
// so that it stays a tail call, and a loop elsewhere in the
// function changes nothing.
// IR-UNTIL OutlineColdOperations
// IR= 0 pathBesideLoop  = Call v
// IR= 1 pathBesideLoop  = PropGet v[0-9]+ name="slice"
// IR= 1 pathBesideLoop  = TailCall v[0-9]+, v[0-9]+ \(
// IR= 0 pathWithoutLoop  = Call(Method)? v
// IR= 0 part CallMethod
// IR= 0 larger CallBuiltin .* overload=Math
// IR= 2 countDown  = TailCall v
function pathBesideLoop(request) {
  const url = request.url;
  const start = url.indexOf("/", url.indexOf(":") + 4);
  let i = start;
  for (; i < url.length; i++) {
    if (url.charCodeAt(i) === 63) break;
  }
  return url.slice(start, i);
}
function pathWithoutLoop(request) {
  const url = request.url;
  const start = url.indexOf("/", url.indexOf(":") + 4);
  const end = url.indexOf("?", start);
  const path = url.slice(start, end < 0 ? url.length : end);
  return url.charCodeAt(0) === 63 ? "" : path;
}
function from(text, needle, start) {
  const found = text.indexOf(needle, start);
  return text.charCodeAt(0) === 63 ? -2 : found;
}
function part(text, start, end) {
  const taken = text.slice(start, end);
  return text.charCodeAt(0) === 63 ? "" : taken;
}
function larger(pair) {
  const most = Math.max(pair.a, pair.b);
  const whole = Math.floor(pair.a);
  return [most, whole, Object.is(most, -0), Object.is(whole, -0)];
}
const notAString = {
  length: 3,
  indexOf(needle, from) {
    return "indexOf(" + needle + "," + from + ")";
  },
  charCodeAt() {
    return 63;
  },
  slice(from, to) {
    return "slice(" + from + "," + to + ")";
  },
};
const requests = JSON.parse(
  '[{"url":"http://localhost:3000/users/1?page=2"},{"url":"https://example.com/a/b"},{"url":"http://h:1/?"},{"url":""},{"url":"no scheme"},{"url":"http://\\u00e9\\u4e2d/\\u4e2d?\\u00e9"},{"url":"?"},{"url":["http:","","/","x","?","/","y"]},{"url":12},{"url":null},{},{"url":0},{"url":0},{"url":0}]',
);
requests[11].url = "http://" + "a".repeat(40) + "/" + "b".repeat(40);
requests[12].url = new String("http://boxed/path?q");
requests[13].url = notAString;
const functions = [pathBesideLoop, pathWithoutLoop, from, part];
for (const path of functions.slice(0, 2)) {
  for (const request of requests) {
    try {
      console.log(path.name, JSON.stringify(path(request)));
    } catch (error) {
      console.log(path.name, error.constructor.name);
    }
  }
}
const texts = JSON.parse('["a/b/c/\\u4e2d/d","a/b/c/d/e"]');
const starts = JSON.parse('[0,2,-1,100,1.5,-0,null,"2",true,2147483648,-2147483649,1e300]').concat([NaN, Infinity, -Infinity, undefined, { valueOf: () => 3 }]);
const [, , find, take] = functions;
for (const text of texts) {
  for (const start of starts)
    console.log(find(text, "/", start), find(text, "", start), find(text, "/c", start), find(text, 1, start), take(text, start, 5), take(text, 1, start), take(text, start));
}
console.log(find(notAString, "/", 1), take(notAString, 1, 2));
try {
  find(texts[0], "/", { valueOf() { throw new RangeError("from valueOf"); } });
} catch (error) {
  console.log(error.message);
}
try {
  find(texts[0], { toString() { throw new RangeError("from toString"); } }, { valueOf() { throw new RangeError("not reached"); } });
} catch (error) {
  console.log(error.message);
}
const pairs = JSON.parse(
  '[{"a":1,"b":2},{"a":1.5,"b":-2.5},{"a":"7","b":3},{"a":null,"b":-1},{"a":true,"b":0},{"b":1},{"a":-0,"b":-0},{"a":-0.5,"b":-1},{"a":1e300,"b":-1e300},{"a":[5],"b":4},{"a":{},"b":4},{"a":2147483647,"b":2147483648},{"a":0,"b":0},{"a":0,"b":0}]',
);
pairs[12].a = { valueOf: () => 9.5 };
pairs[13].a = 1n;
const [measure] = [larger, part];
for (const pair of pairs) {
  try {
    console.log(String(measure(pair)));
  } catch (error) {
    console.log(error.constructor.name);
  }
}
function countDown(object, n) {
  "use strict";
  if (n < 0) return object.charCodeAt(0);
  return object.slice(n, countDown);
}
const recursive = {
  slice(n, next) {
    "use strict";
    return n ? next(this, n - 1) : "the stack did not grow";
  },
};
console.log(countDown(texts[0], 2), countDown(recursive, 200000));
