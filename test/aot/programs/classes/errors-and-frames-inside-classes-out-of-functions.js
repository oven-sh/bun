// What is thrown while a class out of a function is evaluated or constructed, and which functions the frames name.
const lines = [];
const names = (error) => error.stack.split("\n").slice(1, 6).map((line) => (line.match(/at (?:new )?([^ (]+)/) || [, "?"])[1].replace(/^.*[\\/]/, "file")).join(">");
class Base { constructor(fail) { if (fail === "base") throw new Error("in base"); } }
const Failing = (Parent) => class Inner extends Parent { field = Failing.fail === "field" ? (() => { throw new Error("in field"); })() : 1; constructor(fail) { super(fail); if (fail === "mixin") throw new Error("in mixin"); } method() { throw new Error("in method"); } };
class A extends Failing(Base) {}
for (const fail of ["base", "mixin"]) { try { new A(fail); } catch (error) { lines.push(error.message + ":" + names(error)); } }
Failing.fail = "field"; try { new A(); } catch (error) { lines.push(error.message + ":" + names(error)); } Failing.fail = null;
try { new A().method(); } catch (error) { lines.push(error.message + ":" + names(error)); }
try { A(); } catch (error) { lines.push(error.constructor.name + ":" + error.message); }
try { Object.getPrototypeOf(A)(); } catch (error) { lines.push(error.constructor.name + ":" + error.message); }
const Early = (Parent) => class extends Parent { static first = Early.missing.value; };
try { class B extends Early(Base) {} } catch (error) { lines.push(error.constructor.name + ":" + names(error)); }
try { class C extends Failing(C) {} } catch (error) { lines.push(error.constructor.name); }
lines.push(Object.getPrototypeOf(A).name, A.name, Failing(Base).name, String(Object.getPrototypeOf(A).prototype.constructor === Object.getPrototypeOf(A)));
console.log(lines.join("\n"));
