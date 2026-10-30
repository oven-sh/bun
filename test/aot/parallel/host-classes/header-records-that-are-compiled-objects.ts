// A record of headers that is an object of compiled code and holds nothing but strings is put into the Headers without a list of pairs in between. Whatever the record is, the Headers, or the error, are plain Bun's.
const lines: string[] = [];
function say(label: string, work: () => unknown) {
  let text: string;
  try {
    const value = work();
    text = JSON.stringify(value instanceof Headers ? [...value] : value) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name + ": " + (error as Error).message;
  }
  lines.push(label + ": " + text);
}

const kept: object[] = [];
function keep<T extends object>(record: T): T {
  kept.push(record);
  return record;
}
const inResponse = (record: object) => new Response("x", { headers: record as HeadersInit }).headers;
const inRequest = (record: object) => new Request("http://localhost/", { headers: record as HeadersInit }).headers;
const alone = (record: object) => new Headers(record as HeadersInit);
function each(label: string, make: () => object) {
  say(label + ", in a Response", () => inResponse(make()));
  say(label + ", in a Request", () => inRequest(make()));
  say(label + ", alone", () => alone(make()));
}
function withDefault(contentType: string, more?: Record<string, string>) {
  return keep({ "Content-Type": contentType, ...more });
}

each("one header", () => keep({ "Content-Type": "text/plain" }));
each("a default and nothing more", () => withDefault("application/json"));
each("a default and more", () => withDefault("application/json", { "x-a": "1", "Cache-Control": "no-store" }));
each("no header", () => keep({}));
each("common and uncommon names", () => keep({ ETag: '"e"', "x-b": "2", Location: "/a", "X-C": "3", "content-length": "1" }));
each("the same name in two cases", () => keep({ "x-a": "1", "X-A": "2", "content-type": "a/b", "Content-Type": "c/d" }));
each("cookies", () => keep({ "Set-Cookie": "a=1", "set-cookie": "b=2", Cookie: "c=3", cookie: "d=4" }));
each("spaces around the values", () => keep({ "x-a": "  1  ", "x-b": "\t2\t", "x-c": "" }));
each("a value made of pieces", () => keep({ "x-a": ["a", "b"].join("-") + String(kept.length % 1) + "c".repeat(3) }));
each("an invalid name", () => keep({ "x a": "1" }));
each("an empty name", () => keep({ "": "1" }));
each("an invalid value", () => keep({ "x-a": "1\n2" }));
each("a value outside Latin-1", () => keep({ "x-a": "\u{1F600}" }));
each("the first invalid header is reported", () => keep({ "x-a": "1\n", "x b": "2" }));
each("an invalid name in front of a symbol", () => keep({ "x a": "1", "x-b": Symbol.iterator }));
each("an invalid name in front of an object that throws", () =>
  keep({
    "x a": "1",
    "x-b": {
      toString() {
        throw new RangeError("no b");
      },
    },
  }),
);
each("numbers, booleans, null and undefined", () => keep({ a: 1, b: true, c: null, d: undefined, e: 1.5, f: -0 }));
each("an object among the strings", () => keep({ a: "1", b: { toString: () => "2" }, c: "3" }));
each("names like numbers come first", () => keep({ b: "1", "2": "two", a: "3", "1": "one" }));
each("a computed name", () => keep({ [["x", "computed"].join("-")]: "1", "x-after": "2" }));
each("a name stored late", () => {
  const record: Record<string, string> = keep({ "x-a": "1" });
  record["x-late"] = "2";
  record[["x", "later"].join("-")] = "3";
  return record;
});
each("a name deleted", () => {
  const record: Record<string, string> = keep({ "x-a": "1", "x-b": "2", "x-c": "3" });
  delete record["x-b"];
  return record;
});
each("a name deleted and stored again", () => {
  const record: Record<string, string> = keep({ "x-a": "1", "x-b": "2", "x-c": "3" });
  delete record["x-a"];
  record["x-a"] = "4";
  return record;
});
each("a name that is not enumerable", () => {
  const record = keep({ "x-a": "1" });
  Object.defineProperty(record, "x-hidden", { value: "2", enumerable: false });
  return record;
});
each("a getter", () =>
  keep({
    "x-a": "1",
    get "x-b"() {
      return "2";
    },
  }),
);
each("a symbol for a name", () => keep({ "x-a": "1", [Symbol("s")]: "2" }));
each("a symbol for a name that is not enumerable", () => {
  const record = keep({ "x-a": "1" });
  Object.defineProperty(record, Symbol("s"), { value: "2", enumerable: false });
  return record;
});
each("an iterator of its own", () =>
  keep({
    "x-a": "1",
    *[Symbol.iterator]() {
      yield ["x-b", "2"];
    },
  }),
);
each("an iterator that is undefined", () => keep({ "x-a": "1", [Symbol.iterator]: undefined }));
each("a name __proto__", () => keep({ ["__proto__"]: "1" }));
each("another prototype", () => keep({ __proto__: { inherited: "no" }, own: "yes" }));
each("a prototype with an iterator", () =>
  keep({
    __proto__: {
      *[Symbol.iterator]() {
        yield ["x-c", "3"];
      },
    },
    own: "yes",
  }),
);
each("no prototype", () => {
  const record = Object.create(null) as Record<string, string>;
  record["x-a"] = "1";
  return keep(record);
});
class Fields {
  "x-a" = "1";
  "x-b" = "2";
  get "x-c"() {
    return "3";
  }
}
each("an instance of a class", () => keep(new Fields()));
each("a frozen record", () => Object.freeze(keep({ "x-a": "1" })));
each("many headers", () => keep({ a: "1", b: "2", c: "3", d: "4", e: "5", f: "6", g: "7", h: "8", i: "9", j: "10", k: "11", l: "12" }));
say("the record is copied", () => {
  const record = keep({ "x-a": "1" });
  const headers = alone(record);
  record["x-a"] = "changed";
  return headers;
});
say("one record many times", () => {
  const record: Record<string, string> = keep({ "Content-Type": "text/plain", "x-round": "" });
  let length = 0;
  for (let round = 0; round < 300; round++) {
    record["x-round"] = "r" + round;
    length += inResponse(record).get("x-round")!.length;
  }
  return length;
});
say("each record is still there", () => kept.length);
console.log(lines.join("\n"));
