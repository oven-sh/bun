"use strict";
// `for (..; i < data[w].length; ..) { s = s + data[w][i]; data[w][i] = data[w][i] + extra; }`: the row under the key is read once in front and the loop is built for what the row is, as if `const r = data[w]` stood there:
// a store into an element of the row lays nothing under a name of the holder. Whatever is handed, the answer is plain's. HERE: what is added is an object whose valueOf lays a getter under the key.
const zero = JSON.parse("0"), made = () => JSON.parse('{"rows":[1,2,3,4,5,6,7,8,9,10,11,12],"other":[100,200,300,400,500,600]}');
let counted = 0;
const held = made(), key = "rows", more = { valueOf() { counted++; if (counted === 4) Object.defineProperty(held, "rows", { get() { counted += 100; return [5, 5, 5, 5, 5, 5]; }, enumerable: true }); return 1; } };
function row(data, w, extra) { let s = 0; for (let i = 0; i < data[w].length; i++) { s = s + data[w][i]; data[w][i] = data[w][i] + extra; } return s; }
const tried = (run) => { try { return String(run()); } catch (error) { return error.name; } };
console.log(tried(() => row([held][zero], [key][zero], [more][zero])), counted, tried(() => row([held][zero], [key][zero], [more][zero])), counted, JSON.stringify(held));
