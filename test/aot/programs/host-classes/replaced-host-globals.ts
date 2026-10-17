// The global names Request, Response, Blob, Headers, URL and URLSearchParams can be replaced. Code that names a replaced global gets the replacement, never a shortcut for the original class.
const lines: string[] = [];
function say(label: string, work: () => unknown) {
  let text: string;
  try {
    text = JSON.stringify(work()) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name + ": " + (error as Error).message;
  }
  lines.push(label + ": " + text);
}
const globals = globalThis as unknown as Record<string, unknown>;
const originals = { Request, Response, Blob, Headers, URL, URLSearchParams };

const makeRequest = (url: string) => new Request(url);
const makeResponse = (body: string, status: number) => new Response(body, { status, headers: { "x-made": "here" } });
const makeJSON = (value: unknown) => Response.json(value);
const makeBlob = (text: string) => new Blob([text]);
const makeHeaders = () => new Headers({ a: "1" });
const pathnameOf = (text: string) => new URL(text).pathname;
const queryOf = (text: string, name: string) => new URL(text).searchParams.get(name);
const paramOf = (text: string, name: string) => new URLSearchParams(text).get(name);
const everything = () => [
  makeRequest("http://example.com/a").url,
  makeResponse("body", 201).status,
  makeResponse("body", 201).headers.get("x-made"),
  makeJSON({ a: 1 }).headers.get("content-type"),
  makeJSON({ a: 1 }).status,
  makeBlob("abc").size,
  makeHeaders().get("a"),
  pathnameOf("http://example.com/a/b?c=d"),
  queryOf("http://example.com/a/b?c=d", "c"),
  paramOf("c=d", "c"),
];
function warm() {
  let last: unknown;
  for (let i = 0; i < 200; i++) last = everything();
  return last;
}

say("before anything is replaced", warm);

say("each global replaced by a subclass", () => {
  globals.Request = class extends originals.Request {
    override get url() {
      return "replaced " + super.url;
    }
  };
  globals.Response = class extends originals.Response {
    override get status() {
      return super.status + 1000;
    }
    static override json(value: unknown) {
      return new originals.Response(JSON.stringify(value), { status: 299, headers: { "content-type": "replaced/json" } });
    }
  };
  globals.Blob = class extends originals.Blob {
    override get size() {
      return super.size + 1000;
    }
  };
  globals.Headers = class extends originals.Headers {
    override get(name: string) {
      return "replaced " + super.get(name);
    }
  };
  globals.URL = class extends originals.URL {
    override get pathname() {
      return "/replaced" + super.pathname;
    }
    override get searchParams() {
      return new originals.URLSearchParams("c=replaced");
    }
  };
  globals.URLSearchParams = class extends originals.URLSearchParams {
    override get(name: string) {
      return "replaced " + super.get(name);
    }
  };
  return warm();
});
say("the replacements are what the names answer", () => Object.keys(originals).map(name => globals[name] !== (originals as Record<string, unknown>)[name]));
say("an instance of a replacement is an instance of the original", () => [makeRequest("http://example.com/") instanceof originals.Request, makeHeaders() instanceof originals.Headers]);

say("each global replaced by an unrelated class", () => {
  for (const name of Object.keys(originals)) {
    globals[name] = class {
      url = "unrelated";
      status = -1;
      size = -1;
      pathname = "unrelated";
      headers = { get: () => "unrelated" };
      searchParams = { get: () => "unrelated" };
      get() {
        return "unrelated";
      }
      static json() {
        return { status: -2, headers: { get: () => "unrelated json" } };
      }
    };
  }
  return warm();
});

say("each global deleted", () => {
  const answers = Object.keys(originals).map(name => delete globals[name]);
  let error = "";
  try {
    makeHeaders();
  } catch (e) {
    error = (e as Error).constructor.name;
  }
  return [answers, error, typeof globals.URL];
});

say("the originals restored", () => {
  Object.assign(globals, originals);
  return warm();
});

say("one static function replaced", () => {
  const json = originals.Response.json;
  (originals.Response as unknown as Record<string, unknown>).json = () => new originals.Response("x", { status: 298 });
  const status = makeJSON({}).status;
  originals.Response.json = json;
  return [status, makeJSON({}).status];
});

say("a local binding with the name of a global", () => {
  class URL {
    pathname = "local";
    constructor(readonly text: string) {}
  }
  class Headers {
    get(name: string) {
      return "local " + name;
    }
  }
  return [new URL("http://example.com/a").pathname, new Headers().get("a")];
});

console.log(lines.join("\n"));
