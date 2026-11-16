"use strict";
// `for (const w of Object.keys(data)) for (..; i < data[w].length; ..) s = s + data[w][i]`: in the inner loop holder and key stand in front. Where the holder is a plain object and an own value lies under the key, the read runs no
// code and finds the same in every turn of the inner loop, so it is made once in front of it. Whatever the holder is, the answer is plain's. HERE: the holder is a proxy.
const zero = JSON.parse("0"), made = () => JSON.parse('{"a":[1,2,3,4,5],"b":[10,20,30],"c":[0.5,1.5]}');
let counted = 0;
const held = new Proxy(made(), { get(target, name) { counted++; return target[name]; } }), more = 0;
const data = [held][zero], extra = [more][zero];
function f(t) { let s = t & 1; for (const w of Object.keys(data)) for (let i = 0; i < data[w].length; i++) { s = s + data[w][i]; } return s; }
const tried = (run) => { try { return String(run()); } catch (error) { return error.name; } };
console.log(tried(() => f(0)), counted, tried(() => f(1)), counted);
