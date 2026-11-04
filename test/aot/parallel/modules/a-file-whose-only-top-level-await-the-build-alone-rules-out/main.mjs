// Each file queues a job that sets a flag, and has a top-level `await` that no run reaches. Where `bun run` keeps the `await`, the file is an asynchronous module:
// the file that imports it goes on a turn later and finds the flag set. What the build knows beyond that changes nothing in it.
console.log("platform", (await import("./reads-platform.mjs")).seen);
console.log("platform-in-else", (await import("./reads-platform-in-else.mjs")).seen);
console.log("platform-in-a-conditional", (await import("./reads-platform-in-a-conditional.mjs")).seen);
console.log("platform-for-await", (await import("./reads-platform-for-await.mjs")).seen);
console.log("platform-as-an-operand", (await import("./reads-platform-as-an-operand.mjs")).seen);
console.log("architecture", (await import("./reads-architecture.mjs")).seen);
console.log("environment", (await import("./reads-environment.mjs")).seen);
console.log("constant-behind-an-export", (await import("./reads-constant-behind-an-export.mjs")).seen);
console.log("type-of-bun", (await import("./reads-type-of-bun.mjs")).seen);
console.log("version-of-bun", (await import("./reads-version-of-bun.mjs")).seen);
console.log("is-bun", (await import("./reads-is-bun.mjs")).seen);
console.log("browser", (await import("./reads-browser.mjs")).seen);
console.log("main-module", (await import("./reads-main-module.mjs")).seen);
console.log("loop-that-never-turns", (await import("./reads-loop-that-never-turns.mjs")).seen);
console.log("not-known-to-anybody", (await import("./reads-not-known-to-anybody.mjs")).seen);
console.log("reached", (await import("./reads-reached.mjs")).seen);
console.log("no-await", (await import("./reads-no-await.mjs")).seen);
// `bun run` removes these itself, so there the file is an ordinary module.
console.log("removed-behind-false", (await import("./reads-removed-behind-false.mjs")).seen);
console.log("removed-behind-zero", (await import("./reads-removed-behind-zero.mjs")).seen);
console.log("removed-behind-null", (await import("./reads-removed-behind-null.mjs")).seen);
console.log("removed-right-of-false", (await import("./reads-removed-right-of-false.mjs")).seen);
console.log("removed-right-of-true", (await import("./reads-removed-right-of-true.mjs")).seen);
console.log("removed-behind-two-numbers", (await import("./reads-removed-behind-two-numbers.mjs")).seen);
console.log("removed-behind-two-texts", (await import("./reads-removed-behind-two-texts.mjs")).seen);
console.log("removed-for-await", (await import("./reads-removed-for-await.mjs")).seen);
console.log("removed-await-using", (await import("./reads-removed-await-using.mjs")).seen);
