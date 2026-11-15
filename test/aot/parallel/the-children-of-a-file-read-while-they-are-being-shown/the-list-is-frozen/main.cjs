"use strict";
const attempt = (label, deed) => { try { console.log("SAID", label, String(deed())); } catch (error) { console.log("SAID", label, "throws", error.constructor.name); } };
Object.freeze(module.children);
attempt("require a", () => require("./a.cjs"));
attempt("read 1", () => module.children.length);
attempt("read 2", () => module.children.length);
attempt("require b", () => require("./b.cjs"));
attempt("read 3", () => module.children.length);
