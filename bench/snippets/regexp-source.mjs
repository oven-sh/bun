import fastDeepEqual from "fast-deep-equal/es6/index";
import { bench, run } from "../runner.mjs";

const literal = /foo+bar/;
const literalRoute = /^\/users\/(\d+)\/items\/(\d+)$/;
const stringRoute = new RegExp("^/users/(\\d+)/items/(\\d+)$");
const otherRoute = new RegExp("^/posts/(\\d+)/items/(\\d+)$");
const empty = new RegExp("");
const lineTerminator = new RegExp("a\nb");
const clean600 = new RegExp("a".repeat(600));
const clean600Wide = new RegExp("\u0101".repeat(600));
const needsEscape600 = new RegExp("a".repeat(599) + "/");

let sink = 0;

bench("/foo+bar/.source", () => {
  sink += literal.source.length;
});

bench("/^\\/users\\/(\\d+)\\/items\\/(\\d+)$/.source", () => {
  sink += literalRoute.source.length;
});

bench('new RegExp("^/users/(\\\\d+)/items/(\\\\d+)$").source', () => {
  sink += stringRoute.source.length;
});

bench('new RegExp("").source', () => {
  sink += empty.source.length;
});

bench('new RegExp("a\\nb").source', () => {
  sink += lineTerminator.source.length;
});

bench("600 characters, nothing to escape", () => {
  sink += clean600.source.length;
});

bench("600 UTF-16 characters, nothing to escape", () => {
  sink += clean600Wide.source.length;
});

bench("600 characters, one unescaped slash", () => {
  sink += needsEscape600.source.length;
});

bench("a.source === b.source (two different routes)", () => {
  sink += stringRoute.source === otherRoute.source ? 1 : 0;
});

bench("String(regExp)", () => {
  sink += String(literalRoute).length;
});

// The literal makes a new object each time. All of them share one engine RegExp, and so one source.
bench("/x+y/.source, the literal evaluated each time", () => {
  sink += /x+y/.source.length;
});

// fast-deep-equal compares two RegExps by `source` and `flags`: four reads of `source` here.
const left = { id: 1, route: /^\/users\/(\d+)$/, nested: { filter: /foo+bar/gi } };
const right = { id: 1, route: /^\/users\/(\d+)$/, nested: { filter: /foo+bar/gi } };
bench("fast-deep-equal, two objects with two RegExps each", () => {
  sink += fastDeepEqual(left, right) ? 1 : 0;
});

let counter = 0;
bench("a new pattern text each time, source read once", () => {
  sink += new RegExp("^/users/" + counter++ + "/(\\d+)$").source.length;
});

bench("a new pattern text each time, source not read", () => {
  sink += new RegExp("^/users/" + counter++ + "/(\\d+)$").lastIndex;
});

await run();

if (sink < 0) console.log(sink);
