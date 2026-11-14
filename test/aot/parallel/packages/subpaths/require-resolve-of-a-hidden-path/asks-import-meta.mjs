import attempt from "./main.cjs";

attempt("import.meta.resolve", () => import.meta.resolve("hides-by-null/hidden.js"));
attempt("import.meta.resolve of the package", () => import.meta.resolve("hides-by-null"));
