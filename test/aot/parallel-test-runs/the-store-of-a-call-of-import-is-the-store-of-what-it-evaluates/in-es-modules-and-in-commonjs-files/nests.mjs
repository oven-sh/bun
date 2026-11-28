say("nests");
await store.run("inner", () => import("./inner.cjs"));
say("nests");
