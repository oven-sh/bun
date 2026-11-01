// Prints where a prefix operator throws, or calls what throws, if it stands behind other prefix operators: all operators of such a row are reported where the first one stands.
function show(run) {
  try {
    run();
    console.log(run.name + " no error");
  } catch (error) {
    const frames = String(error && error.stack).split("\n").slice(1, 3);
    console.log(run.name + " " + (error && error.constructor.name) + " " + frames.map(line => line.replace(/.*:(\d+:\d+)\)?$/, "$1").replace(/^\s*at /, "")).join(" < "));
  }
}
const hide = value => [value, 0][Number(process.argv.length > 100)];
const amount = hide(10n), symbol = hide(Symbol("s")), thrower = { valueOf() { throw new Error("converted"); }, toString() { throw new Error("written"); } };
show(function notPlus() { return !+amount; });
show(function typeofPlus() { return typeof +amount; });
show(function minusPlus() { return - +amount; });
show(function bitNotMinus() { return ~-symbol; });
show(function voidPlus() { return void +amount; });
show(function notParenthesized() { return !(+amount); });
show(function notNotPlus() { return !!+amount; });
show(function notConverted() { return !+thrower; });
show(function typeofConverted() { return typeof -thrower; });
show(function inSum() { return 1 + !+amount; });
show(function awaited() { return [!+amount]; });
show(function plus_ret() { const v = +amount; return v; });
show(function plus_not() { const v = +amount; return !v; });
show(function plus_typeofV() { const v = +amount; return typeof v; });
show(function plus_voidV() { const v = +amount; return void v; });
show(function plus_onePlus() { const v = +amount; return 1 + v; });
show(function neg_ret() { const v = -symbol; return v; });
show(function neg_not() { const v = -symbol; return !v; });
show(function neg_typeofV() { const v = -symbol; return typeof v; });
show(function neg_voidV() { const v = -symbol; return void v; });
show(function neg_onePlus() { const v = -symbol; return 1 + v; });
