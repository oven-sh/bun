// Prints the line and column of the frame in which one operator of a longer expression throws.
const big = Date.now() > 0 ? 10n : 0;
const one = Date.now() > 0 ? 1 : 0;
const text = Date.now() > 0 ? "text" : "";
const o = { x: 1, f() { return 1; } };
const converts = { valueOf() { throw new RangeError("converted"); } };
function id(x) { return x; }
function show(label, f) {
  try {
    f(one);
    console.log(label, "did not throw");
  } catch (error) {
    console.log(label, error.name, error.stack.split("\n")[1].trim().replace(/.*:(\d+:\d+)\)?$/, "$1"));
  }
}
show("one operator", n => n + big);
show("higher rank on the right", n => n + n * big);
show("higher rank on the left", n => n * n + big);
show("three operators", n => n + n + n * big);
show("parentheses on the right", n => n + (n + big));
show("parentheses that are not needed", n => (n + big) + n);
show("nested parentheses", n => n - (n - (n - big)));
show("behind a call", n => id(n) + n * big);
show("a call in the middle", n => n + id(n) * big);
show("a member in the middle", n => n + o.x * big);
show("a method in the middle", n => n + o.f() * big);
show("something behind it", n => n + n * big + id(n));
show("an argument", n => id(n + n * big));
show("an element", n => [n + n * big]);
show("a property", n => ({ k: n + n * big }));
show("under a comparison", n => n < n * big + n);
show("under ==", n => n == n * big);
show("under ===", n => n === n * big);
show("under &&", n => n && n * big);
show("under a comma", n => (n, n * big));
show("under a condition", n => n ? n * big : 0);
show("power", n => n ** n ** big);
show("power under a product", n => n * n ** big);
show("behind typeof", n => typeof n + n * big);
show("behind !", n => !n + n * big);
show("assigned", n => { let r = 0; r = n + n * big; });
show("added to", n => { let r = 0; r += n + n * big; });
show("initializer", n => { const r = n + n * big; return r + 1; });
show("returned", n => { return n + n * big; });
show("tested", n => { if (n + n * big) return 1; });
show("in a template", n => `${n + n * big}`);
show("beside a template", n => n + `${n}` * big);
show("bits", n => n | n & big);
show("shift", n => n << n + big);
show("read from", n => (n + n * big).x);
show("a key", n => o[n + n * big]);
show("an argument of new", n => new id(n + n * big));
show("returned, parentheses first", n => { id(n); return (n + n) * big; });
show("thrown, parentheses first", n => { throw (n + n) * big; });
show("while, parentheses first", n => { while ((n + n) * big) {} });
show("switch, parentheses first", n => { switch ((n + n) * big) {} });
show("arrow body, parentheses first", n => (n + n) * big);
show("assigned to a member, parentheses first", n => { o.x = (n + n) * big; });
show("over lines", n => {
  return n +
    o.x * n +
    text - big * 3;
});
show("lower rank over lines", n => {
  return (
    o.x ^
    text |
    big
    ^ -n
  );
});
show("added to over lines", n => {
  let result = 0;
  result += "s"
    + n * big;
  return result;
});
show("converted over lines", n => {
  return (+text & 2.5) -
    converts -
    1;
});
