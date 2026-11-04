const report = value => console.log(typeof value === "string" ? value : String(value));
// Generated: classes that share a prototype object, a kind of cell or a row of classes, each asked about the values of all.
const show = (value) => value === true ? "1" : value === false ? "0" : String(value);
function attempt(act) { try { return act(); } catch (error) { return "T"; } }
function maybe(name, make, values) { try { values.push([name, make()]); } catch (error) { values.push([name + ", which cannot be made: " + error.name, undefined]); } }

function isRequest(x) { return x instanceof Request; }
function countRequest(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Request) count++; } return count; }
function isResponse(x) { return x instanceof Response; }
function countResponse(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Response) count++; } return count; }
function isHeaders(x) { return x instanceof Headers; }
function countHeaders(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Headers) count++; } return count; }
function isFormData(x) { return x instanceof FormData; }
function countFormData(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof FormData) count++; } return count; }
function isURLSearchParams(x) { return x instanceof URLSearchParams; }
function countURLSearchParams(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof URLSearchParams) count++; } return count; }
function isURL(x) { return x instanceof URL; }
function countURL(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof URL) count++; } return count; }
function isBlob(x) { return x instanceof Blob; }
function countBlob(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Blob) count++; } return count; }
function isReadableStream(x) { return x instanceof ReadableStream; }
function countReadableStream(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof ReadableStream) count++; } return count; }
const tests = [["Request", isRequest, countRequest], ["Response", isResponse, countResponse], ["Headers", isHeaders, countHeaders], ["FormData", isFormData, countFormData], ["URLSearchParams", isURLSearchParams, countURLSearchParams], ["URL", isURL, countURL], ["Blob", isBlob, countBlob], ["ReadableStream", isReadableStream, countReadableStream]];
const values = [];
maybe("created below Request.prototype", () => Object.create(Request.prototype), values);
maybe("Request.prototype", () => Request.prototype, values);
maybe("Request", () => Request, values);
maybe("new Request", () => new Request("http://a.example/"), values);
maybe("new of a class below Request", () => new (class extends Request {})("http://a.example/"), values);
maybe("new Request without its prototype", () => Object.setPrototypeOf(new Request("http://a.example/"), null), values);
maybe("new Request below Response.prototype", () => Object.setPrototypeOf(new Request("http://a.example/"), Response.prototype), values);
maybe("a proxy of new Request", () => new Proxy(new Request("http://a.example/"), {}), values);
maybe("Request made for Response as new.target", () => Reflect.construct(Request, ["http://a.example/"], Response), values);
maybe("created below Response.prototype", () => Object.create(Response.prototype), values);
maybe("Response.prototype", () => Response.prototype, values);
maybe("Response", () => Response, values);
maybe("new Response", () => new Response("a"), values);
maybe("new of a class below Response", () => new (class extends Response {})("a"), values);
maybe("new Response without its prototype", () => Object.setPrototypeOf(new Response("a"), null), values);
maybe("new Response below Headers.prototype", () => Object.setPrototypeOf(new Response("a"), Headers.prototype), values);
maybe("a proxy of new Response", () => new Proxy(new Response("a"), {}), values);
maybe("Response made for Headers as new.target", () => Reflect.construct(Response, ["a"], Headers), values);
maybe("created below Headers.prototype", () => Object.create(Headers.prototype), values);
maybe("Headers.prototype", () => Headers.prototype, values);
maybe("Headers", () => Headers, values);
maybe("new Headers", () => new Headers(), values);
maybe("new of a class below Headers", () => new (class extends Headers {})(), values);
maybe("new Headers without its prototype", () => Object.setPrototypeOf(new Headers(), null), values);
maybe("new Headers below FormData.prototype", () => Object.setPrototypeOf(new Headers(), FormData.prototype), values);
maybe("a proxy of new Headers", () => new Proxy(new Headers(), {}), values);
maybe("Headers made for FormData as new.target", () => Reflect.construct(Headers, [], FormData), values);
maybe("created below FormData.prototype", () => Object.create(FormData.prototype), values);
maybe("FormData.prototype", () => FormData.prototype, values);
maybe("FormData", () => FormData, values);
maybe("new FormData", () => new FormData(), values);
maybe("new of a class below FormData", () => new (class extends FormData {})(), values);
maybe("new FormData without its prototype", () => Object.setPrototypeOf(new FormData(), null), values);
maybe("new FormData below URLSearchParams.prototype", () => Object.setPrototypeOf(new FormData(), URLSearchParams.prototype), values);
maybe("a proxy of new FormData", () => new Proxy(new FormData(), {}), values);
maybe("FormData made for URLSearchParams as new.target", () => Reflect.construct(FormData, [], URLSearchParams), values);
maybe("created below URLSearchParams.prototype", () => Object.create(URLSearchParams.prototype), values);
maybe("URLSearchParams.prototype", () => URLSearchParams.prototype, values);
maybe("URLSearchParams", () => URLSearchParams, values);
maybe("new URLSearchParams", () => new URLSearchParams("a=1"), values);
maybe("new of a class below URLSearchParams", () => new (class extends URLSearchParams {})("a=1"), values);
maybe("new URLSearchParams without its prototype", () => Object.setPrototypeOf(new URLSearchParams("a=1"), null), values);
maybe("new URLSearchParams below URL.prototype", () => Object.setPrototypeOf(new URLSearchParams("a=1"), URL.prototype), values);
maybe("a proxy of new URLSearchParams", () => new Proxy(new URLSearchParams("a=1"), {}), values);
maybe("URLSearchParams made for URL as new.target", () => Reflect.construct(URLSearchParams, ["a=1"], URL), values);
maybe("created below URL.prototype", () => Object.create(URL.prototype), values);
maybe("URL.prototype", () => URL.prototype, values);
maybe("URL", () => URL, values);
maybe("new URL", () => new URL("http://a.example/"), values);
maybe("new of a class below URL", () => new (class extends URL {})("http://a.example/"), values);
maybe("new URL without its prototype", () => Object.setPrototypeOf(new URL("http://a.example/"), null), values);
maybe("new URL below Blob.prototype", () => Object.setPrototypeOf(new URL("http://a.example/"), Blob.prototype), values);
maybe("a proxy of new URL", () => new Proxy(new URL("http://a.example/"), {}), values);
maybe("URL made for Blob as new.target", () => Reflect.construct(URL, ["http://a.example/"], Blob), values);
maybe("created below Blob.prototype", () => Object.create(Blob.prototype), values);
maybe("Blob.prototype", () => Blob.prototype, values);
maybe("Blob", () => Blob, values);
maybe("new Blob", () => new Blob(["a"]), values);
maybe("new of a class below Blob", () => new (class extends Blob {})(["a"]), values);
maybe("new Blob without its prototype", () => Object.setPrototypeOf(new Blob(["a"]), null), values);
maybe("new Blob below ReadableStream.prototype", () => Object.setPrototypeOf(new Blob(["a"]), ReadableStream.prototype), values);
maybe("a proxy of new Blob", () => new Proxy(new Blob(["a"]), {}), values);
maybe("Blob made for ReadableStream as new.target", () => Reflect.construct(Blob, [["a"]], ReadableStream), values);
maybe("created below ReadableStream.prototype", () => Object.create(ReadableStream.prototype), values);
maybe("ReadableStream.prototype", () => ReadableStream.prototype, values);
maybe("ReadableStream", () => ReadableStream, values);
maybe("new ReadableStream", () => new ReadableStream(), values);
maybe("new of a class below ReadableStream", () => new (class extends ReadableStream {})(), values);
maybe("new ReadableStream without its prototype", () => Object.setPrototypeOf(new ReadableStream(), null), values);
maybe("new ReadableStream below Request.prototype", () => Object.setPrototypeOf(new ReadableStream(), Request.prototype), values);
maybe("a proxy of new ReadableStream", () => new Proxy(new ReadableStream(), {}), values);
maybe("ReadableStream made for Request as new.target", () => Reflect.construct(ReadableStream, [], Request), values);
maybe("Response.json({})", () => (Response.json({})), values);
maybe("Response.error()", () => (Response.error()), values);
maybe(`Response.redirect("http://a.example/")`, () => (Response.redirect("http://a.example/")), values);
maybe(`new Response("a").clone()`, () => (new Response("a").clone()), values);
maybe(`new Request("http://a.example/").clone()`, () => (new Request("http://a.example/").clone()), values);
maybe(`new Response("a").headers`, () => (new Response("a").headers), values);
maybe(`new Request("http://a.example/").headers`, () => (new Request("http://a.example/").headers), values);
maybe(`new Response("a").body`, () => (new Response("a").body), values);
maybe(`new URL("http://a.example/?a=1").searchParams`, () => (new URL("http://a.example/?a=1").searchParams), values);
maybe(`new Request(new Request("http://a.example/"))`, () => (new Request(new Request("http://a.example/"))), values);
for (const [name, value] of values) {
  let answers = "";
  for (const [, is, count] of tests) answers += show(attempt(() => is(value))) + show(attempt(() => count(value)));
  report(answers + " " + name);
}
const ordinary = Function.prototype[Symbol.hasInstance];
report("Request: " + (Request[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Request, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Request, value))) + show(attempt(() => Request[Symbol.hasInstance](value)))).join(""));
report("Response: " + (Response[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Response, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Response, value))) + show(attempt(() => Response[Symbol.hasInstance](value)))).join(""));
report("Headers: " + (Headers[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Headers, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Headers, value))) + show(attempt(() => Headers[Symbol.hasInstance](value)))).join(""));
report("FormData: " + (FormData[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(FormData, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(FormData, value))) + show(attempt(() => FormData[Symbol.hasInstance](value)))).join(""));
report("URLSearchParams: " + (URLSearchParams[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(URLSearchParams, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(URLSearchParams, value))) + show(attempt(() => URLSearchParams[Symbol.hasInstance](value)))).join(""));
report("URL: " + (URL[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(URL, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(URL, value))) + show(attempt(() => URL[Symbol.hasInstance](value)))).join(""));
report("Blob: " + (Blob[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Blob, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Blob, value))) + show(attempt(() => Blob[Symbol.hasInstance](value)))).join(""));
report("ReadableStream: " + (ReadableStream[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(ReadableStream, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(ReadableStream, value))) + show(attempt(() => ReadableStream[Symbol.hasInstance](value)))).join(""));
process.exit(0);
