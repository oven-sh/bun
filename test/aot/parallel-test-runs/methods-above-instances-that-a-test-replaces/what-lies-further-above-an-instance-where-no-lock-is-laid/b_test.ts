import { test } from "bun:test";
// One file of the run names Bun.plugin: code that nobody compiled may run, so the build lays no lock at all, as in the whole shards of a large application.
test("names the plugin", () => { if (process.env.NOTHING_IS_SET_HERE) Bun.plugin({ name: "made-up", setup() {} }); });
