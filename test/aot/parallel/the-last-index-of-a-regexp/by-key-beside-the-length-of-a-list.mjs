const at = (o, k) => o[k], put = (o, k, v) => { o[k] = v; };
const l = [1, 2, 3], re = /a/g;
for (let i = 0; i < 100; i++) { put(re, "lastIndex", i); at(re, "lastIndex"); at(l, "length"); }
put(l, "length", 1);
console.log(at(re, "lastIndex"), at(l, "length"), l.join(), at([, "x"], "length"), at(re, "length"));
