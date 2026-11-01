// An import copies the exports of a CommonJS file into a namespace, which runs each enumerable getter once, also where the importer names nothing of the file.
import "./defined.cjs";
import "./literal.cjs";
import "./lazy-require.cjs";
import "./throws.cjs";
import "./marked.cjs";
import * as unused from "./under-unused-namespace.cjs";
console.log("main ends");
