// An import with a type gets one module, whether the type and the name are written in the call or put together at run time: a data: URL, a file, a built-in module.
import * as listed from 'data:application/json,{"a":1}' with { type: "json" };
import * as words from "./words.txt" with { type: "text" };
import * as query from "./query.sql" with { type: "text" };
const made = text => text.split("").join("");
const options = type => ({ with: { type } });
const show = loaded => Object.keys(loaded).join() + " " + JSON.stringify(loaded.default);
const compare = async (what, first, second) => {
  const [one, other] = [await first(), await second()];
  console.log(what + ":", one === other, show(one), "|", show(other));
};

await compare(
  "a URL as JSON, the type made second",
  () => import('data:application/json,{"a":11}', { with: { type: "json" } }),
  () => import('data:application/json,{"a":11}', { with: { type: made("json") } }),
);
await compare(
  "a URL as JSON, the type made first",
  () => import('data:application/json,{"a":12}', { with: { type: made("json") } }),
  () => import('data:application/json,{"a":12}', { with: { type: "json" } }),
);
await compare(
  "a URL as JSON, the options made",
  () => import('data:application/json,{"a":13}', { with: { type: "json" } }),
  () => import('data:application/json,{"a":13}', options("json")),
);
await compare(
  "a URL as JSON, the URL made",
  () => import('data:application/json,{"a":14}', { with: { type: "json" } }),
  () => import(made('data:application/json,{"a":14}'), { with: { type: "json" } }),
);
await compare(
  "a URL as JSON, the URL made first",
  () => import(made('data:application/json,{"a":15}'), { with: { type: made("json") } }),
  () => import('data:application/json,{"a":15}', { with: { type: "json" } }),
);
await compare(
  "a URL that a statement imports",
  () => listed,
  () => import('data:application/json,{"a":1}', { with: { type: made("json") } }),
);
await compare(
  "a URL as text",
  () => import("data:text/plain,a = 16", { with: { type: "text" } }),
  () => import("data:text/plain,a = 16", { with: { type: made("text") } }),
);
await compare(
  "a URL as TOML",
  () => import(made("data:text/plain,a = 17"), { with: { type: made("toml") } }),
  () => import("data:text/plain,a = 17", { with: { type: "toml" } }),
);
await compare(
  "a URL as JSON and as text",
  () => import('data:application/json,{"a":18}', { with: { type: "json" } }),
  () => import('data:application/json,{"a":18}', { with: { type: made("text") } }),
);
await compare(
  "a URL as text and as JSON, both written too",
  () => import('data:application/json,{"a":19}', { with: { type: made("text") } }),
  () => import('data:application/json,{"a":19}', { with: { type: made("json") } }),
);
if (globalThis.never) {
  await import('data:application/json,{"a":19}', { with: { type: "json" } });
  await import('data:application/json,{"a":19}', { with: { type: "text" } });
}

await compare(
  "a JSON file, the name made",
  () => import("./numbers.json", { with: { type: "json" } }),
  () => import(made("./numbers.json"), { with: { type: "json" } }),
);
await compare(
  "a JSON file, the name and the type made",
  () => import(made("./numbers.json"), { with: { type: made("json") } }),
  () => import("./numbers.json", { with: { type: "json" } }),
);
await compare(
  "a text file that a statement imports",
  () => words,
  () => import(made("./words.txt"), { with: { type: made("text") } }),
);
await compare(
  "a file that is text by the type alone",
  () => query,
  () => import(made("./query.sql"), options(made("text"))),
);
await compare(
  "a JSON file as text",
  () => import("./letters.json", { with: { type: "text" } }),
  () => import(made("./letters.json"), { with: { type: made("text") } }),
);
await compare(
  "a TOML file",
  () => import(made("./settings.toml"), { with: { type: made("toml") } }),
  () => import("./settings.toml", { with: { type: "toml" } }),
);

const showPath = loaded => Object.keys(loaded).join() + " " + typeof loaded.default + " " + loaded.__esModule;
const compareFiles = async (what, first, second) => {
  const [one, other] = [await first(), await second()];
  console.log(what + ":", one === other, showPath(one), "|", showPath(other));
};
await compareFiles(
  "a JSON file as a file, the name made both times",
  () => import(made("./carried.json"), { with: { type: "file" } }),
  () => import(made("./carried.json"), { with: { type: made("file") } }),
);
// Of the types that are the host's own, the one that a name made at run time is loaded with first answers for the others.
await compareFiles(
  "a JSON file as a file, then as text",
  () => import(made("./carried.json"), { with: { type: made("file") } }),
  () => import(made("./carried.json"), { with: { type: made("text") } }),
);
await compare(
  "a file as text, then as TOML",
  () => import(made("./either.txt"), { with: { type: made("text") } }),
  () => import(made("./either.txt"), { with: { type: made("toml") } }),
);
if (globalThis.never) {
  await import("./carried.json", { with: { type: "file" } });
  await import("./either.txt", { with: { type: "text" } });
  await import("./either.txt", { with: { type: "toml" } });
}

const [path, samePath] = [
  await import("node:path", { with: { type: "json" } }),
  await import(made("node:path"), { with: { type: made("json") } }),
];
console.log("a built-in module is one module:", path === samePath);

// What is stored through one is read through the other.
const first = await import('data:application/json,{"a":21,"list":[1]}', { with: { type: "json" } });
const second = await import('data:application/json,{"a":21,"list":[1]}', { with: { type: made("json") } });
second.default.a = 22;
second.default.added = "late";
second.default.list.push(2);
delete second.default.nothing;
console.log(first.default.a, first.default.added, first.default.list.join(), Object.keys(first.default).join());
const third = await import(made("./stored.json"), { with: { type: made("json") } });
const fourth = await import("./stored.json", { with: { type: "json" } });
third.default.a = "stored";
third.default.inner.b = 3.5;
console.log(fourth.default.a, fourth.default.inner.b, fourth.a);
