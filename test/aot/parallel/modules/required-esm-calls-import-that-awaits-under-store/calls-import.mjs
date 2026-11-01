see("calls-import");
store.run("import", () => import("./above.mjs")).then(() => see("behind the import()"));
export {};
