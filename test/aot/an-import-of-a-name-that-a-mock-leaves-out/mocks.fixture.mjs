import { mock, test } from "bun:test";
const say = async (label, act) => {
  let said;
  try {
    said = await act();
  } catch (error) {
    said = "THROWS " + error.constructor.name + " " + String(error.message).replace(/'\/[^']*\//g, "'");
  }
  console.log(label, "|", said);
};
const keys = namespace => Object.keys(namespace).join();

mock.module("./shapes.mjs", () => ({ area: () => "fake" }));
await say("01 a name that the mock gives", async () => (await import("./imports-area.mjs")).seen());
await say("02 a const", async () => (await import("./imports-sides.mjs")).seen());
await say("03 the same importer again", async () => (await import("./imports-sides.mjs")).seen());
await say("04 the default", async () => (await import("./imports-default.mjs")).seen());
await say("05 a function", async () => (await import("./imports-function.mjs")).seen());
await say("06 a class", async () => (await import("./imports-class.mjs")).seen());
await say("07 a let that the importer never reads", async () => (await import("./imports-count-and-never-reads-it.mjs")).seen());
await say("08 under another name", async () => (await import("./imports-under-another-name.mjs")).seen());
await say("09 export from", async () => keys(await import("./exports-sides-from.mjs")));
await say("10 export default from", async () => keys(await import("./exports-default-from.mjs")));
await say("11 imported and exported in two statements", async () => keys(await import("./imports-and-exports-sides.mjs")));
await say("12 through a file that hands it on", async () => (await import("./imports-corners.mjs")).seen());
await say("13 another name of that file", async () => (await import("./imports-area-handed-on.mjs")).seen());
await say("14 through export *", async () => (await import("./imports-sides-through-star.mjs")).seen());
await say("15 through export *, a name that the mock gives", async () => (await import("./imports-area-through-star.mjs")).seen());
await say("16 the keys of the file with export *", async () => keys(await import("./hands-on-all.mjs")));
await say("17 a namespace import", async () => (await import("./imports-namespace.mjs")).seen());
await say("18 an importer of the importer", async () => (await import("./imports-the-importer.mjs")).seen());
await say("19 TypeScript drops an import that nothing reads", async () => (await import("./typed.ts")).seen());

mock.module("./left-road.mjs", () => ({}));
await say("20 two roads, one of them mocked", async () => (await import("./imports-by-both-roads.mjs")).seen());
await say("21 the mocked road", async () => (await import("./imports-by-left-road.mjs")).seen());
await say("22 the other road", async () => (await import("./imports-by-right-road.mjs")).seen());
await say("23 the keys behind both roads", async () => keys(await import("./both-roads.mjs")));

mock.module("./ring-end.mjs", () => ({ alsoInRing: "fake" }));
await say("24 a ring of export *", async () => (await import("./imports-from-ring.mjs")).seen());
await say("25 a ring of export *, a name that the mock gives", async () => (await import("./imports-kept-from-ring.mjs")).seen());

await import("./early.mjs");
mock.module("./early.mjs", () => ({ replaced: "fake" }));
await say("26 a module that was loaded before its mock keeps the rest", async () => (await import("./imports-early.mjs")).seen());

mock.module("./whole.mjs", () => ({ a: "fake a", default: "fake default" }));
await say("27 a mock that gives every name", async () => (await import("./imports-whole.mjs")).seen());

mock.module("./two-names.mjs", () => ({ alias: "fake alias" }));
await say("28 one variable under two names: the one given", async () => (await import("./imports-alias.mjs")).seen());
await say("29 one variable under two names: the one left out", async () => (await import("./imports-first.mjs")).seen());

mock.module("./tools.mjs", () => ({ saw: "fake" }));
await say("30 the first importer has a CommonJS file to link too", async () => (await import("./imports-tools-and-a-commonjs-file.mjs")).seen());
test("ran", () => {});
