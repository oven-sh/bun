// `new Response(body, { status, statusText, headers })` with a literal that the call alone has is compiled to a call that takes the literal's members. Every shape of init gives the Response, or the error, of plain Bun.
// response-literal-init.ts is the same program with the global and Response.json replaced at the end, so that no call of it is known.
// STATISTIC: LiteralArgumentsTakenApart >= 40
const lines: string[] = [];
async function say(label: string, work: () => unknown) {
  let text: string;
  try {
    const value = await work();
    text = value instanceof Response ? await describe(value) : JSON.stringify(value) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name + ": " + (error as Error).message;
  }
  lines.push(label + ": " + text);
}
async function describe(response: Response) {
  return JSON.stringify([response.status, response.statusText, response.ok, [...response.headers], await response.text(), Object.getPrototypeOf(response) === Response.prototype]);
}

function oneHeader(body: string, kind: string) {
  return new Response(body, { status: 201, headers: { "Content-Type": kind } });
}
function statusOnly(body: string, status: number) {
  return new Response(body, { status });
}
function stringAlone(body: string) {
  return new Response(body);
}
function anythingAlone(body: unknown) {
  return new Response(body as BodyInit);
}
function headersObject(body: string, headers: Headers) {
  return new Response(body, { status: 202, headers });
}
function wrap(body: string, init: ResponseInit) {
  return new Response(body, init);
}
function throughHelper(body: string) {
  return wrap(body, { status: 203, statusText: "Helped", headers: { "x-helper": "yes" } });
}
function headersFor(id: string): Record<string, string> {
  return { "x-content-type-options": "nosniff", "cache-control": "no-store", "x-request-id": id };
}
function positive(value: number) {
  if (value < 0) throw new RangeError("negative");
  return { value };
}
function insideTry(value: number, id: string) {
  try {
    return Response.json(positive(value), { status: 200 + positive(value).value, headers: headersFor(id) });
  } catch (error) {
    try {
      return new Response((error as Error).message, { status: positive(value + 500).value, statusText: "Failed", headers: headersFor(id) });
    } catch {
      return null;
    }
  }
}
const kept: ResponseInit[] = [];
function initEscapes(body: string) {
  const init = { status: 204 + 1, headers: { "x-kept": "yes" } };
  kept.push(init);
  return new Response(body, init);
}
function initFromParameter(body: string, init: ResponseInit) {
  kept.push(init);
  return new Response(body, init);
}
function unknownKey(body: string) {
  return new Response(body, { status: 206, method: "POST" } as ResponseInit);
}
function spreadInit(body: string, more: ResponseInit) {
  return new Response(body, { status: 207, ...more });
}

type View = { id: number; title: string; tags: string[] };
function jsonWithHeaders(view: View, id: string) {
  return Response.json(view, { headers: { "X-Request-Id": id, "Cache-Control": "no-store" } });
}
function jsonWithStatus(view: View, status: number) {
  return Response.json(view, { status, statusText: "Made" });
}
function jsonWithNumber(view: View) {
  return Response.json(view, 202 as unknown as ResponseInit);
}
function jsonAlone(view: View) {
  return Response.json(view);
}

const usedAsValues = [oneHeader, statusOnly, stringAlone, anythingAlone, headersObject, throughHelper, insideTry, initEscapes, initFromParameter, unknownKey, spreadInit, jsonWithHeaders, jsonWithStatus, jsonWithNumber, jsonAlone];
await say("each function is also used as a value", () => usedAsValues.map(each => each.name).join());
await say("one header", () => oneHeader("a", "text/plain"));
await say("status only", () => statusOnly("b", 404));
await say("a string alone", () => stringAlone("alone"));
await say("an empty string alone", () => stringAlone(""));
await say("anything alone", async () => [await describe(anythingAlone("text")), await describe(anythingAlone(undefined)), await describe(anythingAlone(new Blob(["b"], { type: "x/y" }))), await describe(anythingAlone(7))]);
await say("a Headers object", () => headersObject("c", new Headers({ a: "1", b: "2" })));
await say("a Headers object is copied", () => {
  const headers = new Headers({ a: "1" });
  const response = headersObject("c", headers);
  headers.set("a", "changed");
  return response;
});
await say("through a helper", () => throughHelper("d"));
await say("init escapes", () => initEscapes("e"));
await say("init from a parameter", () => initFromParameter("f", { status: 299 }));
await say("an unknown key", () => unknownKey("g"));
await say("a spread", () => spreadInit("h", { statusText: "Spread" }));

await say("an empty init", () => new Response("x", {}));
await say("empty headers", () => new Response("x", { headers: {} }));
await say("undefined for every key", () => new Response("x", { status: undefined, statusText: undefined, headers: undefined }));
await say("null headers", () => new Response("x", { headers: null as unknown as undefined }));
await say("null status", () => new Response("x", { status: null as unknown as number }));
await say("null and empty status text", async () => [await describe(new Response("x", { statusText: null as unknown as string })), await describe(new Response("x", { statusText: "" }))]);
await say("a number for the status text", () => new Response("x", { statusText: 5 as any }));
for (const status of [101, 199, 200, 599, 600, 0, -1, 200.9, NaN, Infinity, "201", "x", true, 2 ** 40]) await say("status " + String(status), () => new Response(null, { status: status as any }));
await say("many headers", () => new Response("x", { headers: { "Content-Type": "text/html", "X-A": "1", "x-b": "2", "Cache-Control": "no-store", "Set-Cookie": "a=1", ETag: '"e"' } }));
await say("the same name in two cases", () => new Response("x", { headers: { "x-a": "1", "X-A": "2", "content-type": "a/b", "Content-Type": "c/d" } }));
await say("values with spaces around them", () => new Response("x", { headers: { "x-a": "  1  ", "x-b": "\t2\t" } }));
await say("an invalid name", () => new Response("x", { headers: { "x a": "1" } }));
await say("an empty name", () => new Response("x", { headers: { "": "1" } }));
await say("an invalid value", () => new Response("x", { headers: { "x-a": "1\n2" } }));
await say("a value outside Latin-1", () => new Response("x", { headers: { "x-a": "\u{1F600}" } }));
await say("the first invalid header is reported", () => new Response("x", { headers: { "x-a": "1\n", "x b": "2" } }));
await say("names like numbers come first", () => new Response("x", { headers: { b: "1", "2": "two", a: "3", "1": "one" } }));
await say("a computed name", () => {
  const name = ["x", "computed"].join("-");
  return new Response("x", { headers: { [name]: "1", "x-after": "2" } });
});
await say("a name __proto__", () => new Response("x", { headers: { ["__proto__"]: "1" } }));
await say("headers with another prototype", () => new Response("x", { headers: { __proto__: { inherited: "no" }, own: "yes" } as unknown as Record<string, string> }));
await say("headers as pairs", () => new Response("x", { headers: [["a", "1"], ["b", "2"]] }));
await say("a getter among the headers", () => {
  const seen: string[] = [];
  const response = new Response("x", {
    headers: {
      a: "1",
      get b() {
        seen.push("b");
        return "2";
      },
    },
  });
  return [[...response.headers], seen];
});

await say("values are converted in order, then the status, then the body", () => {
  const seen: string[] = [];
  const noting = (name: string, value: unknown) => ({
    toString() {
      seen.push(name);
      return String(value);
    },
    valueOf() {
      seen.push(name + " valueOf");
      return value;
    },
  });
  const response = new Response(noting("body", "text") as any, {
    statusText: noting("statusText", "Fine") as any,
    status: noting("status", 201) as any,
    headers: { a: noting("a", 1) as any, b: noting("b", 2) as any },
  });
  return [seen, response.status, response.statusText, [...response.headers]];
});
await say("operands are evaluated in source order", () => {
  const seen: string[] = [];
  const note = <T,>(name: string, value: T) => (seen.push(name), value);
  new Response(note("body", "x"), { headers: { a: note("a", "1"), b: note("b", "2") }, status: note("status", 200), statusText: note("statusText", "OK") });
  return seen;
});
await say("a conversion that throws stops the rest", () => {
  const seen: string[] = [];
  try {
    new Response("x", {
      headers: {
        a: {
          toString() {
            seen.push("a");
            throw new RangeError("no a");
          },
        } as any,
        b: {
          toString() {
            seen.push("b");
            return "2";
          },
        } as any,
      },
      status: {
        valueOf() {
          seen.push("status");
          return 200;
        },
      } as any,
    });
  } catch (error) {
    seen.push((error as Error).message);
  }
  return seen;
});
await say("a symbol for a value", () => new Response("x", { headers: { a: Symbol.iterator as any } }));
await say("numbers, booleans, null and undefined for values", () => new Response("x", { headers: { a: 1, b: true, c: null, d: undefined, e: 1.5, f: -0 } as unknown as Record<string, string> }));

await say("bodies of every kind", async () => {
  const bodies: unknown[] = [undefined, null, "", "text", 5, new Blob(["blob"], { type: "x/blob" }), new Uint8Array([104, 105]), new URLSearchParams("a=1"), new ArrayBuffer(2), { toString: () => "object" }];
  const out: string[] = [];
  for (const body of bodies) out.push(await describe(new Response(body as BodyInit, { status: 200, headers: { "x-a": "1" } })));
  return out;
});
await say("a blob's type does not replace a given content type", () => new Response(new Blob(["b"], { type: "x/blob" }), { headers: { "content-type": "x/given" } }));
await say("a stream for the body", () => new Response(new Response("streamed").body, { status: 201, headers: { "x-a": "1" } }));
await say("a used body", () => {
  const first = new Response("used");
  void first.text();
  return new Response(first.body, { status: 200 });
});

await say("inside try: the first path", () => insideTry(1, "t1"));
await say("inside try: the handler's path", () => insideTry(-1, "t2"));
await say("inside try: an operand of the handler's literal throws", () => insideTry(-600, "t3"));
await say("inside try: the status is refused", () => insideTry(500, "t4"));
await say("inside try and catch", () => {
  try {
    return new Response("x", { status: 99, headers: { a: "1" } });
  } catch (error) {
    return "caught " + (error as Error).constructor.name;
  }
});
await say("in a loop", () => {
  let sum = 0;
  for (let i = 0; i < 300; i++) sum += oneHeader("x", "text/" + i).status + statusOnly("y", 200 + (i % 100)).status;
  return sum;
});

const view: View = { id: 7, title: "a \"title\"", tags: ["x", "y"] };
await say("json with headers", () => jsonWithHeaders(view, "r1"));
await say("json with a status", () => jsonWithStatus(view, 201));
await say("json with a number for the init", () => jsonWithNumber(view));
await say("json alone", () => jsonAlone(view));
await say("json with a content type of its own", () => Response.json(view, { headers: { "content-type": "application/problem+json" } }));
await say("json with an empty init", () => Response.json(view, {}));
await say("json with a Headers object", () => Response.json(view, { headers: new Headers({ a: "1" }) }));
await say("json with an invalid status", () => Response.json(view, { status: 99 }));
await say("json with an invalid header", () => Response.json(view, { headers: { "x a": "1" } }));
await say("json of what cannot be serialized", async () => {
  const out: string[] = [];
  for (const value of [undefined, Symbol.iterator, () => 1, 5n]) {
    try {
      out.push(await describe(Response.json(value, { status: 201, headers: { a: "1" } })));
    } catch (error) {
      out.push((error as Error).constructor.name + ": " + (error as Error).message);
    }
  }
  return out;
});
await say("json of primitives, null, arrays and untyped objects", async () => {
  const out: string[] = [];
  for (const value of [null, 1, "text", true, [1, "a", null], JSON.parse('{"b":1,"a":[2]}'), new Date(0), new Map()]) out.push(await describe(Response.json(value, { status: 201, headers: { a: "1" } })));
  return out;
});
await say("the value is serialized before the headers are converted", () => {
  const seen: string[] = [];
  const response = Response.json(
    {
      toJSON() {
        seen.push("toJSON");
        return 1;
      },
    },
    {
      status: {
        valueOf() {
          seen.push("status");
          return 201;
        },
      } as any,
      headers: {
        a: {
          toString() {
            seen.push("a");
            return "1";
          },
        } as any,
      },
    },
  );
  return [seen, response.status];
});
await say("toJSON that throws stops the rest", () => {
  const seen: string[] = [];
  try {
    Response.json(
      {
        toJSON() {
          throw new RangeError("no json");
        },
      },
      {
        headers: {
          a: {
            toString() {
              seen.push("a");
              return "1";
            },
          } as any,
        },
      },
    );
  } catch (error) {
    seen.push((error as Error).message);
  }
  return seen;
});
class Subclass extends Response {
  constructor(body: string) {
    super(body, { status: 210, headers: { "x-subclass": "yes" } });
  }
}
await say("super() in a subclass", async () => [await describe(new Subclass("s")), new Subclass("s") instanceof Subclass]);
await say("Reflect.construct with another new.target", () => Reflect.construct(Response, ["r", { status: 211 }], Subclass) instanceof Subclass);

console.log(lines.join("\n"));
