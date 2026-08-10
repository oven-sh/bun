import util from "node:util";
import { bench, run } from "../runner.mjs";

bench('util.format("hello %s number %d")', () => util.format("hello %s number %d", "world", 42));
bench('util.format("%s:%s:%s")', () => util.format("%s:%s:%s", "GET", "/api/users", "200 OK"));
bench("util.format long message, 2 specifiers", () =>
  util.format("[worker %d] request completed with status %s after some time", 7, "success"),
);
bench("util.format 16-bit format string", () => util.format("café %s — número %d", "olé", 42));
bench("util.format trailing args", () => util.format("plain", "join", "of", "strings", 123));
bench('util.format("%j")', () => util.format("json: %j", { a: 1, b: "two" }));
bench('util.format("%f %i %%")', () => util.format("%f%% done, batch %i", 85.5, 12));

bench("util.inspect short string", () => util.inspect("hello world"));
bench("util.inspect string with quotes", () => util.inspect("it's a \"quoted\" string\nwith a newline"));
bench("util.inspect small object", () => util.inspect({ a: 1, b: "two", c: [1, 2, 3] }));
bench("util.inspect array of numbers", () => util.inspect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));

await run();
