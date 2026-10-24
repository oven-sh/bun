require("./a.js"), require("./other/a.js");
const row = async (name, load) => {
  try {
    const loaded = await load();
    console.log(name, loaded.default ?? loaded);
  } catch (error) {
    const isRefusal = error.code === "MODULE_NOT_FOUND" || error.code === "ERR_MODULE_NOT_FOUND";
    console.log(name, isRefusal ? "is refused" : error);
  }
};
(async () => {
  await row("dir stored", () => import("./dir-stored.mjs"));
  await row("dirname added to", () => import("./dirname-added-to.mjs"));
  await row("under another name", () => import("./under-another-name.mjs"));
  await row("handed to a function", () => import("./handed-to-a-function.mjs"));
  await row("dir stored, joined", () => import("./dir-stored-joined.mjs"));
  await row("dir stored, and a computed name", () => import("./dir-stored-computed.mjs"));
  await row("dir stored, __dirname in the specifier", () => import("./dir-stored-dirname-read.mjs"));
  await row("dir deleted and defined", () => import("./dir-deleted.mjs"));
  await row("url stored, createRequire", () => import("./url-stored.mjs"));
  await row("__filename stored, createRequire", () => require("./filename-stored.cjs"));
  await row("__filename stored by eval, createRequire", () => require("./filename-stored-by-eval.cjs"));
  await row("dir stored, the value of __dirname", () => import("./dirname-after-store.mjs"));
  await row("path stored, the value of __filename", () => import("./filename-after-store.mjs"));
  await row("only read: members", () => import("./only-read-members.mjs"));
  await row("only read: a pattern", () => import("./only-read-pattern.mjs"));
  await row("only read: createRequire", () => import("./only-read-create-require.mjs"));
  await row("__filename untouched, createRequire", () => require("./filename-untouched.cjs"));
})();
