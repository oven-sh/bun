const list = [];
let made;
try { made = new Bun.sql(323); list.push(made); } catch {}
console.log(list.length, typeof list[0], list[0] === made);
