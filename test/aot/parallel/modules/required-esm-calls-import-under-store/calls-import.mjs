import "./beside.cjs";
see("calls-import");
store.run("import", () => import("./imported.mjs")).then(() => see("behind the import()"));
see("end of calls-import");
export {};
