// A function's members seen in every other way.
function A() {}
A.x = 1;
A.y = 2;
console.log(Reflect.ownKeys(A).join(), Object.entries(A).join(";"), JSON.stringify(Object.assign({}, A)), { ...A });
const hide = value => [value][0];
const given = hide(A);
given.z = 3;
console.log(A.z, given.x, Object.keys(given));
given.x = 10;
console.log(A.x);
console.log(new Function("f", "f.x = 11; return f.x + f.y;")(A), A.x);
console.log(eval("A.y = 20; A.x + A.y"), A.y);
const bound = A.bind(null);
console.log(bound.x, "x" in bound, A.hasOwnProperty("x"), Object.hasOwn(A, "y"));
const proxy = new Proxy(A, {});
proxy.x = 12;
console.log(A.x, proxy.y);
console.log(Object.getOwnPropertyDescriptor(A, "x"));
Object.defineProperty(A, "x", { value: 13, writable: false });
try { A.x = 14; } catch (error) { console.log(error.message); }
console.log(A.x);
function S() { "use strict"; }
S.v = 1;
Object.freeze(S);
try { (function () { "use strict"; S.v = 2; })(); } catch (error) { console.log(error.name); }
try { S.v = 3; } catch (error) { console.log(error.message); }
console.log(S.v, Object.isFrozen(S));
function B() {}
console.log(B.m);
function readB() { return B.m; }
console.log(readB());
B.m = 1;
console.log(readB());
function T() { return T.count++; }
T.count = 0;
console.log(T(), T(), T.count);
function N() {}
N.name2 = "x";
N.toString = () => "mine";
N.length2 = 5;
console.log(String(N), N.name, N.length);
function R() {}
R.a = 1;
function D() {}
Object.setPrototypeOf(D, R);
D.b = 2;
console.log(D.a, D.b, Object.keys(D));
function Q() {}
Q.self = Q;
Q.list = [1, 2];
Q.list.push(3);
console.log(Q.self === Q, Q.list.length);
Q.undef = undefined;
console.log("undef" in Q, Object.keys(Q), Q.undef);
function U() {}
U.fn = function () { return this === U; };
U.arrow = () => 1;
console.log(U.fn(), U.arrow(), U.fn.name, U.arrow.name);
