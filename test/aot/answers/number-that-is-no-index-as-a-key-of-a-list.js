// answers: without-library
// # If a key that is a number but no index (-1, 0.5, NaN, an infinity, 4294967295, 1e21) were held for an index, or what lies under it for no part of the list, a read under it would miss what a store under it, by number or by name, has laid there. A counter of a loop is such a key to Link.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 311 of 311 of 311
// # CHECK-NEXT: exited with 0
function toldElement(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldCounted(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldLetter(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function put(list, key, value) { list[key] = value; }
function get(list, key) { toldElement(list[key]); }
function letter(text, key) { toldLetter(text[key]); }
function fill(list, n) { for (let i = 0; i < n; i++) list[i] = i * 2; }
function sum(list, n) { let total = 0; for (let i = 0; i < n; i++) total += list[i]; toldCounted(total); }
function down(list, from) { let total = 0; for (let i = from; i >= -1; i--) total += list[i]; toldCounted(total); }
function halves(list, n) { let total = 0; for (let i = 0; i < n; i += 0.5) total += list[i]; toldCounted(total); }
const list = [];
fill(list, 4);
sum(list, 4);
get(list, 0);
get(list, 3);
get(list, 4);
get(list, -1);
get(list, 0.5);
get(list, 0 / 0);
get(list, 1 / 0);
get(list, -0);
sum(list, 5);
put(list, -1, 100);
put(list, 0.5, "half");
put(list, 0 / 0, "nan");
put(list, 1 / 0, 1.5);
put(list, -0, 7);
put(list, 4294967295, "large");
put(list, 1e21, "larger");
get(list, -1);
get(list, 0.5);
get(list, 0 / 0);
get(list, 1 / 0);
get(list, 0);
get(list, 4294967295);
get(list, 1e21);
toldElement(list.NaN);
toldElement(list.Infinity);
toldElement(list["-1"]);
toldElement(list["0.5"]);
toldElement(list["1e+21"]);
toldElement(list.length);
down(list, 3);
halves(list, 2);
list.NaN = 3;
get(list, 0 / 0);
letter("abc", 1);
letter("abc", 3);
letter("abc", -1);
letter("abc", 0.5);
letter("abc", 0 / 0);
report("end");
