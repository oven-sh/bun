// RUN: lower
// CHECK: function {{*}}kind=Module{{*}}IsAsync

// RUN(GONE): lower
// GONE-NOT: = Await

// RUN(RECORD): link
// RECORD: module {{*}}path="{{*}}await-that-the-build-alone-rules-out.mjs"{{*}}HasTopLevelAwait

// Whether a module is asynchronous is what `bun run` takes it for. It does not know that there is a `Bun`, so it keeps the `await`: whoever imports the module goes on a turn later, though the build has removed the branch.
export const state = { ready: false };
if (typeof Bun === "undefined") {
  await 0;
}
