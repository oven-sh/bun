// The init literal is handed to a parameter typed ResponseInit, as a framework written in TypeScript does: it is taken apart all the same.
const create = (body?: BodyInit | null, init?: ResponseInit): Response => new Response(body, init);
function statusAndHeaders(body: string | null, status: number | undefined, headers: Headers) {
  return create(body, { status, headers });
}
function statusOnly(body: string, status: number) {
  return create(body, { status });
}
function literalHeaders(body: string, kind: string) {
  return create(body, { status: 202, statusText: "Taken", headers: { "Content-Type": kind, "X-One": "1" } });
}
const seen: ResponseInit[] = [];
function kept(body: string, status: number) {
  const init: ResponseInit = { status };
  seen.push(init);
  return create(body, init);
}
const usedAsValues = [statusAndHeaders, statusOnly, literalHeaders, kept];
const shown = (response: Response) => [response.status, response.statusText, response.ok, [...response.headers]];
const outcome = <T>(work: () => T): T | string => {
  try {
    return work();
  } catch (error) {
    return "throws " + (error as Error).constructor.name + ": " + (error as Error).message;
  }
};
const lines: string[] = [usedAsValues.map(each => each.name).join()];
const say = (label: string, value: unknown) => lines.push(label + ": " + JSON.stringify(value));
const given = new Headers({ a: "1", "Content-Type": "text/x-given" });
const first = statusAndHeaders("body", 201, given);
say("a status and a Headers object", [shown(first), await first.text(), first.headers === given]);
first.headers.set("b", "2");
say("the headers are a copy", [[...given], [...first.headers]]);
say("the status is undefined", shown(statusAndHeaders("body", undefined, new Headers())));
say("no body", shown(statusAndHeaders(null, 204, new Headers({ c: "3" }))));
say("only a status", [shown(statusOnly("text", 203)), await statusOnly("text", 203).text()]);
for (const status of [199, 200, 599, 600, 1000, -1, 200.5, NaN]) say("status " + status, outcome(() => shown(statusOnly("text", status))));
say("a null-body status with a body", outcome(() => shown(statusOnly("text", 204))));
say("headers written out", shown(literalHeaders("text", "text/x-kind")));
say("a header value that is not allowed", outcome(() => shown(literalHeaders("text", "bad\nvalue"))));
say("the literal is kept", [shown(kept("text", 205 + 1)), seen]);
{
  const original = globalThis.Response;
  const calls: unknown[] = [];
  try {
    globalThis.Response = class extends original {
      constructor(body?: BodyInit | null, init?: ResponseInit) {
        calls.push([body, init && Object.keys(init), init?.status]);
        super(body, init);
      }
    };
    const replaced = statusAndHeaders("kept", 207, new Headers({ d: "4" }));
    say("the global is replaced", [calls, shown(replaced), replaced instanceof original, Object.getPrototypeOf(replaced) === original.prototype]);
  } finally {
    globalThis.Response = original;
  }
}
say("the global is restored", shown(statusOnly("text", 208)));
let sum = 0;
for (let i = 0; i < 2000; i++) {
  sum += statusAndHeaders("body " + i, 200 + (i % 100), given).status + statusOnly("x", 200 + (i % 50)).status;
  if (i % 500 === 0) Bun.gc(true);
}
say("many", sum);
console.log(lines.join("\n"));
