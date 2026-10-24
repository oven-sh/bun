// A literal of constants has a name that a number converts to ("-1", "1.5", NaN) among its names. Such a name is no field, and the names behind it are listed all the same, in the order in which they were written.
const o = { a: 1, "-1": 8, "01": 9, d: 10 };
console.log(JSON.stringify(o), Object.keys(o).join("|"));
const p = { "0": 7, "01": 9, d: 10 };
console.log(JSON.stringify(p), Object.keys(p).join("|"));
const q = { a: 1, "0": 7, "1": 8, "01": 9, d: 10, e: 11 };
console.log(JSON.stringify(q), Object.keys(q).join("|"));
const r = { "key with space": 1, 'quote"': 2, "\xE9": 3, "日": 4, "": 5, "\n": 6, "0": 7, "-1": 8, "01": 9, __proto__x: 10 };
console.log(JSON.stringify(r));
console.log(Object.keys(r).join("|"));
console.log(r["01"], r.__proto__x);
const show = (o) => console.log(JSON.stringify(o), Object.keys(o).join("|"), Reflect.ownKeys(o).join("|"));
show({ a: 1, "-1": 8, d: 10 });
show({ a: 1, "1.5": 8, d: 10 });
show({ a: 1, NaN: 8, d: 10 });
show({ a: 1, Infinity: 8, d: 10 });
show({ a: 1, "-0": 8, d: 10 });
show({ a: 1, "1e21": 8, d: 10 });
show({ a: 1, "4294967295": 8, d: 10 });
show({ a: 1, "4294967294": 8, d: 10 });
const late = { a: 1 };
late["-1"] = 8;
late.d = 10;
show(late);
function make(x) { return { a: x, "-1": x, d: x }; }
show(make(3));
