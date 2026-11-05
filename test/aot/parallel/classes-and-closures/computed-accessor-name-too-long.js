// "set " or "get " in front of a computed name of the greatest length a string can have: a RangeError, as in plain JavaScript.
const prop = "".padEnd(2 ** 31 - 1, "a");
function t(what, f) { try { f(); console.log(what + ": no throw"); } catch (e) { console.log(what + ": " + String(e)); } }
t("a setter of a class", () => { class A { set [prop](_) {} } });
t("a getter of a class", () => { class A { get [prop]() { return 1; } } });
t("a static setter", () => { class A { static set [prop](_) {} } });
t("a setter of a literal", () => ({ set [prop](_) {} }));
t("a getter of a literal", () => ({ get [prop]() { return 1; } }));
t("a method has no prefix", () => { class A { [prop]() {} } });
// The name takes two gigabytes. What plain Bun prints is written down, so that one process holds it and not two at once.
/* Output:
a setter of a class: RangeError: Out of memory: Setter name is too long
a getter of a class: RangeError: Out of memory: Getter name is too long
a static setter: RangeError: Out of memory: Setter name is too long
a setter of a literal: RangeError: Out of memory: Setter name is too long
a getter of a literal: RangeError: Out of memory: Getter name is too long
a method has no prefix: no throw
*/
