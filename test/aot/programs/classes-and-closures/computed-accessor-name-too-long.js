// "set " or "get " in front of a computed name of the greatest length a string can have: a RangeError, as in plain JavaScript.
const prop = "".padEnd(2 ** 31 - 1, "a");
function t(what, f) { try { f(); console.log(what + ": no throw"); } catch (e) { console.log(what + ": " + String(e)); } }
t("a setter of a class", () => { class A { set [prop](_) {} } });
t("a getter of a class", () => { class A { get [prop]() { return 1; } } });
t("a static setter", () => { class A { static set [prop](_) {} } });
t("a setter of a literal", () => ({ set [prop](_) {} }));
t("a getter of a literal", () => ({ get [prop]() { return 1; } }));
t("a method has no prefix", () => { class A { [prop]() {} } });
