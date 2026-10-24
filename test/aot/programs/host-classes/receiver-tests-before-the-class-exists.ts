// Functions that read members of Request and Headers run on plain objects before either class exists. Request is created later, Headers never.
const lines: string[] = [];
const rounds = 10000;

function summarizeTyped(request: Request): string {
  return request.method + " " + request.url;
}
function summarizeUntyped(request: any): string {
  return request.method + " " + request.url;
}
function contentTypeOf(headers: Headers): unknown {
  return headers.has("content-type") ? headers.get("content-type") : "none";
}

function totalLength(receivers: unknown[]): number {
  let length = 0;
  for (let i = 0; i < rounds; i++) {
    const receiver = receivers[i % receivers.length];
    length += summarizeTyped(receiver as Request).length + summarizeUntyped(receiver).length;
  }
  return length;
}

const headerLikes: unknown[] = [
  new Map([["content-type", "text/plain"]]),
  new Map<string, string>(),
  { has: (name: string) => name.length > 3, get: (name: string) => "answer for " + name },
];
function contentTypeCounts(): string {
  const counts = new Map<string, number>();
  for (let i = 0; i < rounds; i++) {
    const answer = String(contentTypeOf(headerLikes[i % headerLikes.length] as Headers));
    counts.set(answer, (counts.get(answer) ?? 0) + 1);
  }
  return [...counts].map(([answer, count]) => answer + " x" + count).join(", ");
}

const plainObjects: unknown[] = [
  { url: "plain://first", method: "GET" },
  { method: "PUT", url: "plain://second", body: null },
];

lines.push("plain objects before the first Request: " + totalLength(plainObjects));
lines.push("header-like objects before the first Request: " + contentTypeCounts());

const first = new Request("http://example.com/first", { method: "POST" });
lines.push("the first Request: " + summarizeTyped(first) + " | " + summarizeUntyped(first));
lines.push("the first Request in a loop: " + totalLength([first]));

class RequestSubclass extends Request {}
class RequestWithOverrides extends Request {
  override get url() {
    return "overridden " + super.url;
  }
  override get method() {
    return "OVERRIDDEN";
  }
}
const withOwnURL = new Request("http://example.com/own", { method: "DELETE" });
Object.defineProperty(withOwnURL, "url", { value: "own url", configurable: true });

const labeled: [string, unknown][] = [
  ["a second Request", new Request("http://example.com/second")],
  ["a subclass instance", new RequestSubclass("http://example.com/subclass", { method: "PATCH" })],
  ["a subclass instance with overrides", new RequestWithOverrides("http://example.com/overrides", { method: "PUT" })],
  ["a Request with an own url", withOwnURL],
  ["a plain object", plainObjects[0]],
  ["an object that inherits from a Request", Object.create(first)],
];
for (const [label, receiver] of labeled) {
  let summary: string;
  try {
    summary = summarizeTyped(receiver as Request) + " | " + summarizeUntyped(receiver);
  } catch (error) {
    summary = "throws " + (error as Error).constructor.name;
  }
  lines.push(label + ": " + summary);
}

const withoutThrowing = labeled.slice(0, 5).map(([, receiver]) => receiver);
lines.push("every kind of receiver in a loop: " + totalLength(withoutThrowing));

delete (withOwnURL as any).url;
lines.push("the own url deleted: " + summarizeTyped(withOwnURL) + " | " + summarizeUntyped(withOwnURL));

Bun.gc(true);
lines.push("a Request after a collection: " + summarizeTyped(new Request("http://example.com/third", { method: "HEAD" })));
lines.push("plain objects after the first Request: " + totalLength(plainObjects));
lines.push("header-like objects after the first Request: " + contentTypeCounts());

console.log(lines.join("\n"));
