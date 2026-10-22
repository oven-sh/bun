// A getter of a native class (Request, Response, Blob) read from every kind of receiver that TypeScript lets pass for an instance: the answers are plain Bun's. Request.prototype itself refuses every change.
import vm from "node:vm";

const lines: string[] = [];
function say(label: string, work: () => unknown, withMessage = true) {
  let text: string;
  try {
    const value = work();
    text = typeof value === "string" ? JSON.stringify(value) : typeof value === "object" && value !== null ? Object.prototype.toString.call(value) : String(value);
  } catch (error) {
    text = "throws " + (error as Error).constructor.name + (withMessage ? ": " + (error as Error).message : "");
  }
  lines.push(label + ": " + text);
}

function urlOf(request: Request): unknown {
  return request.url;
}
function methodOf(request: Request): unknown {
  return request.method;
}
function headersOf(request: Request): unknown {
  return request.headers;
}
function lengthOfUrl(request: Request) {
  return request.url.length;
}
function statusOf(response: Response): unknown {
  return response.status;
}
function statusTextOf(response: Response): unknown {
  return response.statusText;
}
function sizeOf(blob: Blob): unknown {
  return blob.size;
}
function all(label: string, make: () => Request, urlIsText = true) {
  say(label + " url", () => urlOf(make()));
  say(label + " method", () => methodOf(make()));
  say(label + " headers", () => headersOf(make()));
  if (urlIsText) say(label + " url.length", () => lengthOfUrl(make()));
  say(label + " url twice", () => {
    const request = make();
    return urlOf(request) === urlOf(request);
  });
  say(label + " headers twice", () => {
    const request = make();
    return headersOf(request) === headersOf(request);
  });
}

const address = "http://example.com/a/b?c=d";
const fresh = () => new Request(address, { method: "POST", headers: { "x-one": "1" }, body: "abc" });

for (let turn = 0; turn < 200; turn++) {
  urlOf(fresh());
  methodOf(fresh());
  headersOf(fresh());
  lengthOfUrl(fresh());
}

all("an instance", fresh);

all("an own value in front", () => {
  const request = fresh();
  Object.defineProperty(request, "url", { value: "own value", configurable: true });
  Object.defineProperty(request, "method", { value: 7, configurable: true });
  Object.defineProperty(request, "headers", { value: null, configurable: true });
  return request;
});
all("an own value in front, after a read", () => {
  const request = fresh();
  urlOf(request);
  methodOf(request);
  headersOf(request);
  Object.defineProperty(request, "url", { value: "own value", configurable: true });
  Object.defineProperty(request, "method", { value: 7, configurable: true });
  Object.defineProperty(request, "headers", { value: null, configurable: true });
  return request;
});
let reads = 0;
all("an own getter in front", () => {
  const request = fresh();
  Object.defineProperty(request, "url", { get: () => "own getter " + ++reads, configurable: true });
  Object.defineProperty(request, "method", { get: () => undefined, configurable: true });
  Object.defineProperty(request, "headers", { get: () => [reads], configurable: true });
  return request;
});
all("an own getter that throws", () => {
  const request = fresh();
  for (const name of ["url", "method", "headers"])
    Object.defineProperty(request, name, {
      get() {
        throw new RangeError("no " + name);
      },
    });
  return request;
});
all("an own value put in front and deleted", () => {
  const request = fresh();
  Object.defineProperty(request, "url", { value: "own value", configurable: true });
  delete (request as any).url;
  return request;
});
all("another own property", () => {
  const request = fresh();
  (request as any).extra = 1;
  return request;
});
all("frozen", () => Object.freeze(fresh()));
all("frozen after a read", () => {
  const request = fresh();
  urlOf(request);
  return Object.freeze(request);
});
all("not extensible", () => Object.preventExtensions(fresh()));

for (const name of ["url", "method", "headers", "signal", "body", "bodyUsed"]) {
  say("Request.prototype." + name + " redefined", () => Object.defineProperty(Request.prototype, name, { get: () => "replaced" }) === Request.prototype, false);
  say("Request.prototype." + name + " made a value", () => Object.defineProperty(Request.prototype, name, { value: "replaced" }) === Request.prototype, false);
  say("Request.prototype." + name + " deleted", () => delete (Request.prototype as any)[name], false);
  say("Request.prototype." + name + " deleted by Reflect", () => Reflect.deleteProperty(Request.prototype, name));
  say("Request.prototype." + name + " assigned", () => ((Request.prototype as any)[name] = "replaced"), false);
  say("Request.prototype." + name + " assigned by Reflect", () => Reflect.set(Request.prototype, name, "replaced"));
  say("an instance's " + name + " assigned", () => ((fresh() as any)[name] = "replaced"), false);
  say("an instance's " + name + " assigned by Reflect", () => Reflect.set(fresh(), name, "replaced"));
  say("Request.prototype." + name + " described", () => {
    const { get, set, enumerable, configurable } = Object.getOwnPropertyDescriptor(Request.prototype, name)!;
    return [typeof get, typeof set, enumerable, configurable].join();
  });
}
all("an instance after all that", fresh);

class Heir extends Request {}
class HeirWithGetters extends Request {
  override get url() {
    return "heir of " + super.url;
  }
  override get method() {
    return "HEIR";
  }
  override get headers() {
    return new Headers({ heir: "yes" });
  }
}
class HeirWithFields extends Request {
  override url = "a field";
  override method = "FIELD";
}
all("an heir", () => new Heir(address, { method: "PUT" }));
all("an heir with getters", () => new HeirWithGetters(address, { method: "PUT" }));
all("an heir with fields", () => new HeirWithFields(address, { method: "PUT" }));
say("an heir with getters, header", () => (headersOf(new HeirWithGetters(address)) as Headers).get("heir"));

all("a plain object", () => ({ url: "plain", method: "PLAIN", headers: new Headers() }) as Request);
all("a plain object of other types", () => ({ url: 5, method: null, headers: "text" }) as unknown as Request, false);
all("an empty object", () => ({}) as Request, false);
all("an object that inherits from an instance", () => Object.create(fresh()) as Request);
all("an object that inherits from Request.prototype", () => Object.create(Request.prototype) as Request);
all("Request.prototype", () => Request.prototype);
all("an instance with another prototype", () => Object.setPrototypeOf(fresh(), { url: "of the other prototype", method: "OTHER" }) as Request);
all("an instance without a prototype", () => Object.setPrototypeOf(fresh(), null) as Request, false);
all("an instance with a prototype in between", () => Object.setPrototypeOf(fresh(), Object.create(Request.prototype, { url: { value: "in between" } })) as Request);
all("an instance with an empty prototype in between", () => Object.setPrototypeOf(fresh(), Object.create(Request.prototype)) as Request);
all("a Response", () => new Response("x", { status: 201, statusText: "Made", headers: { "x-two": "2" } }) as unknown as Request);
all("a Blob", () => new Blob(["abc"]) as unknown as Request, false);
all("a proxy without traps", () => new Proxy(fresh(), {}));
all("a proxy that reads from its target", () => new Proxy(fresh(), { get: (target, name) => Reflect.get(target, name, target) }));
all("a proxy that answers", () => new Proxy(fresh(), { get: (_, name) => "trapped " + String(name) }));
all("a function", () => function url() {} as unknown as Request, false);
all("an array", () => [] as unknown as Request, false);

const { get: getterOfUrl } = Object.getOwnPropertyDescriptor(Request.prototype, "url")!;
say("the getter on an instance", () => getterOfUrl!.call(fresh()));
say("the getter on an heir", () => getterOfUrl!.call(new HeirWithGetters(address)));
say("the getter on an instance with an own value", () => getterOfUrl!.call(Object.defineProperty(fresh(), "url", { value: "own value" })));
say("the getter on an object", () => getterOfUrl!.call({}));
say("the getter on undefined", () => getterOfUrl!.call(undefined));
say("the getter on a Response", () => getterOfUrl!.call(new Response()));
say("Reflect.get with an object for the receiver", () => Reflect.get(Request.prototype, "url", {}));
say("Reflect.get with an instance for the receiver", () => Reflect.get(Request.prototype, "url", fresh()));
say("Reflect.get of an instance with an object for the receiver", () => Reflect.get(fresh(), "url", {}));
say("Reflect.get of an object with an instance for the receiver", () => Reflect.get({ url: 1 }, "url", fresh()));

say("another realm's function for new.target", () => {
  const other = vm.runInNewContext("(function Other() {})");
  const request = Reflect.construct(Request, [address], other) as Request;
  return [urlOf(request), methodOf(request), Object.getPrototypeOf(request) === Request.prototype, Object.getPrototypeOf(request) === other.prototype].join();
});
say("another realm's function without a prototype for new.target", () => {
  const other = vm.runInNewContext("(function Other() {})");
  other.prototype = null;
  const request = Reflect.construct(Request, [address], other) as Request;
  return [urlOf(request), methodOf(request), Object.getPrototypeOf(request) === Request.prototype].join();
});
say("read in another realm", () => vm.runInNewContext("request.url + ' ' + request.method + ' ' + request.headers.get('x-one')", { request: fresh() }));
say("shadowed in another realm", () => {
  const request = fresh();
  vm.runInNewContext("Object.defineProperty(request, 'url', { value: 'from the other realm' })", { request });
  return urlOf(request);
});

say("the body after a clone", () => {
  const request = fresh();
  const before = request.body;
  const copy = request.clone();
  const after = request.body;
  return [before === after, before === copy.body, after === request.body, Object.prototype.toString.call(after)].join();
});
say("the body of a GET", () => new Request(address).body);
say("the body twice", () => {
  const request = fresh();
  return request.body === request.body;
});
say("bodyUsed before and after", () => {
  const request = fresh();
  const before = request.bodyUsed;
  void request.text();
  return [before, request.bodyUsed].join();
});
say("the signal twice", () => {
  const request = fresh();
  return request.signal === request.signal;
});
say("the signal that was handed in", () => {
  const controller = new AbortController();
  const request = new Request(address, { signal: controller.signal });
  const before = request.signal.aborted;
  controller.abort();
  return [before, request.signal.aborted].join();
});

say("headers written through the cached object", () => {
  const request = fresh();
  (headersOf(request) as Headers).set("x-one", "changed");
  return (headersOf(request) as Headers).get("x-one");
});

say("what an old instance caches lives on", () => {
  const kept: Request[] = [];
  for (let i = 0; i < 200; i++) kept.push(new Request(address + i, { headers: { n: String(i) } }));
  Bun.gc(true);
  Bun.gc(true);
  for (const request of kept) {
    urlOf(request);
    headersOf(request);
  }
  const litter: unknown[] = [];
  for (let i = 0; i < 50000; i++) litter.push({ i, text: "t" + i });
  Bun.gc(false);
  Bun.gc(true);
  let sum = 0;
  for (let i = 0; i < kept.length; i++) if (urlOf(kept[i]) === address + i && (headersOf(kept[i]) as Headers).get("n") === String(i)) sum++;
  return sum + " " + (litter.length === 50000);
});

const made = () => new Response("body", { status: 201, statusText: "Made" });
say("a response's status", () => statusOf(made()));
say("a response's status text", () => statusTextOf(made()));
say("a response's status text twice", () => {
  const response = made();
  return statusTextOf(response) === statusTextOf(response);
});
say("a response with an own status", () => statusOf(Object.defineProperty(made(), "status", { value: "own" })));
say("a plain object for a response", () => statusOf({ status: "plain" } as unknown as Response));
say("a request for a response", () => statusOf(fresh() as unknown as Response));
say("a blob's size", () => sizeOf(new Blob(["abcd"])));
say("a file's size", () => sizeOf(new File(["abcde"], "name.txt")));
say("a plain object for a blob", () => sizeOf({ size: "plain" } as unknown as Blob));
say("a file's name, set", () => {
  const file = new File(["a"], "before.txt");
  const before = file.name;
  (file as any).name = "after.txt";
  return before + " " + file.name;
});

console.log(lines.join("\n"));
