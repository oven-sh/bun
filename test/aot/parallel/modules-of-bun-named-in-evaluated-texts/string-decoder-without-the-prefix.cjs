const read = new Function("load", "return typeof load('string_decoder')");
let answer;
try { answer = read(require); } catch (error) { answer = error.name + ": " + error.message; }
console.log(answer);
