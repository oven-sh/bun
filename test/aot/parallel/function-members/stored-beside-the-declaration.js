// A function's members, stored among the statements of its file.
function K() {}
console.log("before", K.n, "n" in K, Object.keys(K), K.hasOwnProperty("n"));
K.n = 0;
K.a = "text";
console.log("after", K.n, K.a, "n" in K, Object.keys(K), JSON.stringify(Object.getOwnPropertyDescriptor(K, "n")));
K.n = K.n + 1;
const read = name => K[name];
console.log(read("n"), read("a"), read("nothing"));
K["a"] = "by key";
console.log(K.a);
for (const key in K) console.log("in", key);
console.log(Object.getOwnPropertyNames(K).join());
delete K.a;
console.log(K.a, "a" in K, Object.keys(K));
K.a = 2;
console.log(Object.keys(K), K.a);
Object.defineProperty(K, "n", { get() { return "from a getter"; }, configurable: true });
console.log(K.n);
function L() {}
L.first = 1;
if (process.argv.length > 100) L.second = 2;
L.third = 3;
L.second = 22;
console.log(Object.keys(L));
function F() { F.calls = (F.calls || 0) + 1; return F.calls; }
F.calls = 10;
console.log(F(), F(), F.calls);
function G() {}
const other = G;
G.x = 1;
other.x = 2;
console.log(G.x, other.x);
function H() {}
function I() {}
I.v = 1;
Object.setPrototypeOf(I, { w: 5 });
console.log(I.w, I.v);
function P() { this.q = 1; }
P.count = 5;
P.prototype.get = function () { return P.count + this.q; };
console.log(new P().get());
function E() {}
E.y = 1;
export { E };
console.log(E.y);
