const box = [new Response("a"), new Request("http://a/"), new Headers(), new URL("http://a/"), new Blob([]), new ReadableStream(), new FormData(), AbortSignal.abort(), {}, null, 5, new Map(), new URLSearchParams(), new WritableStream(), new TransformStream(), new File([], "f"), new EventTarget()];
function isResponse(x) { return x instanceof Response; }
function isRequest(x) { return x instanceof Request; }
function isHeaders(x) { return x instanceof Headers; }
function isURL(x) { return x instanceof URL; }
function isBlob(x) { return x instanceof Blob; }
function isStream(x) { return x instanceof ReadableStream; }
function isForm(x) { return x instanceof FormData; }
function isSignal(x) { return x instanceof AbortSignal; }
function isTarget(x) { return x instanceof EventTarget; }
function isMap(x) { return x instanceof Map; }
const tests = [isResponse, isRequest, isHeaders, isURL, isBlob, isStream, isForm, isSignal, isTarget, isMap];
let lines = [];
for (let round = 0; round < 50; round++) lines = tests.map(test => test.name + " " + box.map(value => +test(value)).join(""));
console.log(lines.join("\n"));
