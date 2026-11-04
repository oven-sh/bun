// `f(f(n))` with f no function: the inner call fails, and the message quotes it with its arguments. Both calls hold the place that failed.
// `new (make())(1)` with what make() answers no constructor: the callee has no name, and the message quotes the construction.
const say = run => {
  try {
    run();
    console.log("no error");
  } catch (error) {
    console.log(error.constructor.name + ": " + error.message);
  }
};
const hide = x => x;
const one = () => 1;
function twice(f, n) {
  return f(f(n));
}
function thrice(f, n) {
  return f(1, f(n, 2), 3);
}
function member(o, n) {
  return o.f(o.f(n));
}
function made(f, n) {
  return new f(new f(n));
}
function tagged(f, n) {
  return f(f`a${n}`);
}
function other(f, g, n) {
  return g(f(n));
}
function outerAlone(f, n) {
  return f(hide(n));
}
function onTwoLines(f, n) {
  return f(
    f(n),
  );
}
say(() => twice({}, 1));
say(() => thrice({}, 1));
say(() => member({}, 1));
say(() => made({}, 1));
say(() => tagged({}, 1));
say(() => other({}, x => x, 1));
say(() => outerAlone({}, 1));
say(() => onTwoLines({}, 1));
say(() => new (hide(() => 1))());
say(() => new (hide(() => 1)));
say(() => new (hide(() => 1))(1, 2));
say(() => new (hide({}))());
say(() => new (hide(one))(1));
say(() => new (hide(one))(hide(1)));
say(() => new (hide({}))(1, 2));
say(() => new (hide(one))("a"));
say(function () {
  return new (hide(one))(1, 2);
});
say(() => [new (hide(one))(1, 2)]);
say(() => new hide.nothing());
say(() => new (hide(Map))([[1, 2]]).size);
