// A response of node:http keeps its headers, its answer about lenient validation and its socket under three symbols, which a program finds by listing the keys.
// Each way of looking under one of them has a request of its own, so that each is the first look at its response, at four moments and once more at finish.
const http = require("node:http"),
  util = require("node:util");
const names = ["kOutHeaders", "kLenientValidation", "fakeSocket"];
let remembered;
const symbolsOf = object => Object.getOwnPropertySymbols(object).filter(symbol => names.includes(symbol.description));
const show = value =>
  value === null || typeof value !== "object"
    ? String(value)
    : value.constructor === undefined
      ? JSON.stringify(value)
      : "a " + value.constructor.name;
const ways = {
  "by key": (res, key) => res[key],
  "by a key kept from another response": (res, key) =>
    res[remembered.find(symbol => symbol.description === key.description)],
  "Reflect.get": (res, key) => Reflect.get(res, key),
  "a descriptor": (res, key) => Object.getOwnPropertyDescriptor(res, key).value,
  "all descriptors": (res, key) => Object.getOwnPropertyDescriptors(res)[key].value,
  "a spread": (res, key) => ({ ...res })[key],
  "a spread behind another": (res, key) => ({ ...{ a: 1 }, ...res })[key],
  "Object.assign": (res, key) => Object.assign({}, res)[key],
  "Object.assign onto a literal": (res, key) => Object.assign({ a: 1, b: 2 }, res)[key],
  "a rest": (res, key) => {
    const { statusCode, ...rest } = res;
    return rest[key];
  },
  "an heir": (res, key) => Object.create(res)[key],
  "a proxy": (res, key) => new Proxy(res, {})[key],
  "a loop over the keys": (res, key) => {
    let found;
    for (const each of Reflect.ownKeys(res)) {
      const value = res[each];
      if (each === key) found = value;
    }
    return found;
  },
  "inspect": (res, key) => {
    const text = util.inspect(res, { depth: 0 });
    const at = text.indexOf("[Symbol(" + key.description + ")]: ");
    return text.slice(at, text.indexOf("\n", at)).replace(/,$/, "");
  },
  "Bun.inspect": (res, key) => {
    const text = Bun.inspect(res, { depth: 0 });
    const at = text.indexOf("[Symbol(" + key.description + ")]: ");
    return text.slice(at, text.indexOf("\n", at)).replace(/,$/, "");
  },
  "deep equality": (res, key) => Bun.deepEquals({ [key]: res[key] }, { [key]: Reflect.get(res, key) }),
  "a store and a read": (res, key) => {
    const before = res[key];
    res[key] = before;
    return res[key];
  },
  "has": (res, key) => key in res && Object.hasOwn(res, key),
};
const moments = {
  "after setHeader": res => res.setHeader("X-One", "1"),
  "after two and a removal": res => {
    res.setHeader("X-One", "1");
    res.setHeader("X-Two", "2");
    res.removeHeader("x-one");
  },
  "after the only one is removed": res => {
    res.setHeader("X-One", "1");
    res.removeHeader("X-One");
  },
  "after writeHead": res => res.writeHead(201, { "X-Three": "3" }),
  "at the start": () => {},
};
const lines = [];
const server = http.createServer((req, res) => {
  const [, way, moment, name] = decodeURIComponent(req.url).split("/");
  remembered ??= symbolsOf(res);
  if (way === "first") return res.end("ok");
  moments[moment](res);
  const key = remembered.find(symbol => symbol.description === name);
  let answer;
  try {
    answer = show(ways[way](res, key));
  } catch (error) {
    answer = "throws " + error.name + ": " + error.message;
  }
  lines.push(
    way + " | " + moment + " | " + name + ": " + answer + " | then getHeaders() " + JSON.stringify(res.getHeaders()),
  );
  res.on("finish", () => lines.push(way + " | " + moment + " | " + name + " at finish: " + show(res[key])));
  res.setHeader("content-length", 2);
  res.write("o");
  res.end("k");
});
server.listen(0, async () => {
  const base = "http://127.0.0.1:" + server.address().port + "/";
  await (await fetch(base + "first")).text();
  for (const way in ways)
    for (const moment in moments)
      for (const name of names) {
        if (moment === "after writeHead") continue;
        await (await fetch(base + [way, moment, name].map(encodeURIComponent).join("/"))).text();
      }
  console.log(lines.join("\n"));
  server.close();
});
