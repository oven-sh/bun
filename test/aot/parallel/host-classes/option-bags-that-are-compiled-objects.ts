// Bun's natives read the members of an options object by name. An object of compiled code answers such a read from its slot. Whatever the object is, the native sees what plain Bun sees:
// a member that is absent, undefined, deleted, added late, an accessor, or inherited from a class or from an object.
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
  return JSON.stringify([response.status, response.statusText, [...response.headers], await response.text()]);
}

const kept: object[] = [];
function keep<T extends object>(init: T): T {
  kept.push(init);
  return init;
}
function respond(body: string, init: object) {
  return new Response(body, init as ResponseInit);
}
function respondWithJSON(value: unknown, init: object) {
  return Response.json(value, init as ResponseInit);
}

interface Settings {
  status?: number;
  statusText?: string;
  headers?: Record<string, string> | Headers;
  method?: string;
  other?: number;
}
function settings(status: number): Settings {
  return keep({ status, headers: { "x-a": "1" } });
}

await say("two members", () => respond("a", settings(201)));
await say("two members, as JSON", () => respondWithJSON({ a: 1 }, settings(202)));
await say("every member", () => respond("b", keep({ headers: new Headers({ "x-b": "2" }), status: 203, statusText: "Fine", method: "POST" })));
await say("no member", () => respond("c", keep({})));
await say("members the native does not read", () => respond("d", keep({ other: 1, more: "x" })));
await say("undefined for every member", () => respond("e", keep({ status: undefined, statusText: undefined, headers: undefined, method: undefined })));
await say("null for every member but the status", () => respond("f", keep({ statusText: null, headers: null, method: null })));
await say("null for the status", () => respond("f", keep({ status: null })));
await say("an optional member that was never stored", () => {
  const init: Settings = keep({ status: 204 + 1 });
  return respond("g", init);
});
await say("a member stored late", () => {
  const init = settings(206);
  init.statusText = "Late";
  return respond("h", init);
});
await say("a member stored late under a name the literal lacks", () => {
  const init = keep({ other: 1 }) as Settings;
  init.status = 207;
  (init as Record<string, unknown>)["status" + "Text"] = "Computed";
  return respond("i", init);
});
await say("a member deleted", () => {
  const init = settings(208);
  delete init.status;
  return respond("j", init);
});
await say("a member deleted and stored again", () => {
  const init = settings(209);
  delete init.status;
  init.status = 210;
  return respond("k", init);
});
await say("a member of another type than declared", () => {
  const init = settings(211);
  (init as Record<string, unknown>).status = "212";
  return respond("l", init);
});
await say("a member redefined as an accessor", () => {
  const seen: string[] = [];
  const init = settings(213);
  Object.defineProperty(init, "status", {
    get() {
      seen.push("status");
      return 214;
    },
    enumerable: true,
    configurable: true,
  });
  return [respond("m", init).status, seen];
});
await say("an accessor in the literal", () => {
  const seen: string[] = [];
  const init = keep({
    get status() {
      seen.push("status");
      return 215;
    },
    get headers() {
      seen.push("headers");
      return { "x-c": "3" };
    },
  });
  const response = respond("n", init);
  return [response.status, [...response.headers], seen];
});
await say("a member that is not enumerable", () => {
  const init = keep({ other: 1 });
  Object.defineProperty(init, "status", { value: 216, enumerable: false });
  return respond("o", init);
});
await say("a frozen object", () => respond("p", Object.freeze(settings(217))));

class Base {
  status = 218;
  get statusText() {
    return "From the class";
  }
}
class Derived extends Base {
  headers = { "x-d": "4" };
}
await say("an instance of a class: fields and an inherited getter", () => respond("q", keep(new Derived())));
await say("an object that inherits from a literal", () => respond("r", keep(Object.create(settings(219)))));
await say("an object that inherits from a literal and has a member of its own", () => {
  const init = Object.create(settings(220)) as Settings;
  init.statusText = "Own";
  return respond("s", keep(init));
});
await say("a literal with another prototype", () => respond("t", keep({ __proto__: { status: 221 }, statusText: "Above" })));
await say("an object without a prototype", () => {
  const init = Object.create(null) as Settings;
  init.status = 222;
  return respond("u", keep(init));
});
await say("a prototype set late", () => {
  const init = keep({ statusText: "Below" });
  Object.setPrototypeOf(init, { status: 223 });
  return respond("v", init);
});
await say("a conversion changes a member that is read behind it", () => {
  const init: Settings = keep({
    headers: {
      "x-e": {
        toString() {
          init.status = 226;
          init.statusText = "Changed";
          return "5";
        },
      } as unknown as string,
    },
    status: 225,
    statusText: "Unchanged",
  });
  return respond("x", init);
});
await say("a conversion deletes a member that is read behind it", () => {
  const init: Settings = keep({
    headers: {
      "x-f": {
        toString() {
          delete init.status;
          return "6";
        },
      } as unknown as string,
    },
    status: 227,
  });
  return respond("y", init);
});
await say("one object many times", () => {
  const init = settings(228);
  let sum = 0;
  for (let round = 0; round < 300; round++) {
    init.status = 200 + (round % 100);
    sum += respond("z", init).status + respondWithJSON(round, init).status;
  }
  return sum;
});
await say("a Request reads the members of its options", async () => {
  const request = new Request("http://localhost/a", keep({ method: "POST", headers: { "x-g": "7" }, body: "text" }));
  return [request.method, [...request.headers], await request.text()];
});
await say("a Blob reads the type", () => new Blob(["a"], keep({ type: "x/y" })).type);
await say("each object is still what it was", () => kept.length);
console.log(lines.join("\n"));
