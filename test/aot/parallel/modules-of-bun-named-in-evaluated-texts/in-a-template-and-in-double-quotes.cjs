const first = new Function("load", "return typeof load(`zlib`).gzipSync");
const second = new Function("load", 'return typeof load("vm").runInNewContext');
let answer;
try { answer = first(require) + " " + second(require); } catch (error) { answer = error.name + ": " + error.message; }
console.log(answer);
