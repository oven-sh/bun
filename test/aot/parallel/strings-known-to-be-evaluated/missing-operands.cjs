// A list of expressions that lacks an operand is a SyntaxError of the run, and the lists beside it run.
const say = (...a) => console.log(...a);
const attempt = (name, f) => {
  try {
    say(name, f());
  } catch (e) {
    say(name, e.name, e.message);
  }
};
const made = [];
globalThis.a = x => (made.push(["a", x]), 1);
globalThis.b = x => (made.push(["b", x]), 2);
attempt(1, () => new Function("a(), ;"));
attempt(2, () => new Function("a(), b(), ;"));
attempt(3, () => new Function("a(,);"));
attempt(4, () => new Function("a(), , b();"));
attempt(5, () => new Function("(a(),);"));
attempt(6, () => new Function("for (; a(), ;) {}"));
attempt(7, () => new Function(", a();"));
attempt(8, () => new Function("a(), 1 + ;"));
attempt(9, () => new Function("a(), !;"));
attempt(10, () => new Function("a, ;"));
attempt(11, () => new Function("a(), a() ? : 2;"));
attempt(12, () => new Function("a(), a() ? 1 : ;"));
attempt(13, () => new Function("a(), delete ;"));
attempt(14, () => new Function("a(), ++;"));
attempt(15, () => new Function("a(), x = ;"));
attempt(16, () => new Function("a(), `${}`;"));
attempt(17, () => new Function("a(), () => ;"));
attempt(18, () => new Function("a(), () => { b(), ; };"));
attempt(19, () => new Function("return function () { a(), ; };"));
attempt(20, () => new Function("if (a()) b(), ; else b();"));
attempt(21, () => new Function("switch (a()) { case 1: b(), ; }"));
attempt(22, () => new Function("return class { m() { a(), ; } };"));
attempt(23, () => eval("a(), ;"));
attempt(24, () => eval("(function () { a(), ; })"));
attempt(25, () => (0, eval)("a(), , b()"));
attempt(26, () => new Function("a(1), b(1);")());
attempt(27, () => new Function("a(2), b(2), a(3); return b(3), a(4);")());
attempt(28, () => new Function("for (let i = 0; a(i), i < 2; a(5), i++) b(i);")());
attempt(29, () => eval("a(6), b(6)"));
attempt(30, () => new Function("!a(7), -b(7) + a(8), a(9) ? b(9) : a(10); return (a(11), [b(11)]);")());
say(JSON.stringify(made));
