function make(url) { return new Bun.sql(url); }
let r; try { r = make("postgres://localhost/x"); } catch (e) { r = "threw " + e.name; }
console.log(typeof r, typeof r === "function" ? typeof r.begin + " " + typeof r.unsafe : r);
