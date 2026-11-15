const escaped = new Function("s", "return\nimport(s)");
const written = new Function("s", `return
import(s)`);
const plain = new Function("s", "return import(s)");
console.log(escaped("./loaded.mjs"), written("./loaded.mjs"));
console.log((await plain("./other.mjs")).default);
