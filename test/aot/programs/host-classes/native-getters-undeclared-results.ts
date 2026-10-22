// What is read through a declared getter of a native class need not be of the declared type: an own property or a plain object may hold anything, and nothing tests it, because a declaration file declares the member. The receiver is tested: any object, undefined and null pass for `Request`, and a primitive throws a TypeError at the cast.
const lines: string[] = [];
function say(label: string, work: () => unknown) {
  let text: string;
  try {
    text = String(work());
  } catch (error) {
    text = "throws " + (error as Error).constructor.name;
  }
  lines.push(label + ": " + text);
}

function urlOf(request: Request) {
  return request.url;
}
function methodOf(request: Request) {
  return request.method;
}
function headersOf(request: Request) {
  return request.headers;
}
function lengthOfUrl(request: Request) {
  return request.url.length;
}

const address = "http://example.com/a/b?c=d";
const plain = () => ({ url: 5, method: null, headers: "text" }) as unknown as Request;
const shadowed = () => Object.defineProperties(new Request(address), { url: { value: 5 }, method: { value: 7 }, headers: { value: "text" } });
for (const [label, make] of [["a plain object", plain], ["an instance with own values", shadowed]] as const) {
  say(label + " url", () => urlOf(make()));
  say(label + " method", () => methodOf(make()));
  say(label + " headers", () => headersOf(make()));
  say(label + " url.length", () => lengthOfUrl(make()));
}
for (const [label, receiver] of [["undefined", undefined], ["null", null], ["a number", 5], ["a string", "text"], ["a symbol", Symbol.iterator]] as const) {
  say(label + " url", () => urlOf(receiver as unknown as Request));
  say(label + " method", () => methodOf(receiver as unknown as Request));
  say(label + " headers", () => headersOf(receiver as unknown as Request));
}
say("an empty object url.length", () => lengthOfUrl({} as Request));
say("a number url.length", () => lengthOfUrl(5 as unknown as Request));
console.log(lines.join("\n"));
