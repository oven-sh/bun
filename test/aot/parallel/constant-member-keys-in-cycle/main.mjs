import "./exporter.mjs";
import { early } from "./importer.mjs";
import { read, Reader, readByExpression } from "./exporter.mjs";
console.log(early.join(), read({ a: 1 }), new Reader().read({ a: 1 }), readByExpression({ a: 1 }));
