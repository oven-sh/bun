// Prints where errors are reported that operands of string concatenations, compound assignments, templates and logical operators throw.
const converts = {
  valueOf() {
    throw new RangeError("converted");
  },
  toString() {
    throw new RangeError("written");
  },
};
const sign = Symbol("sign");
const big = Date.now() > 0 ? 10n : 0;
const text = Date.now() > 0 ? "text" : "";
const list = [1, 2, 3];
const point = { x: 1, y: 2 };
function same(value) {
  return value;
}
function show(label, call) {
  try {
    call(1);
    console.log(label, "did not throw");
  } catch (error) {
    const frames = error.stack.split("\n").filter(line => line.includes(".js:"));
    const places = frames.slice(0, 2).map(line => line.match(/:(\d+:\d+)\)?$/)[1]);
    console.log(label, "|", error.constructor.name, "|", places.join(" "));
  }
}

show("text in the middle", n => n + "s" + converts + text);
show("object first", n => converts + "s" + n);
show("object first, then typeof", n => converts + typeof n + 1);
show("object second", n => "s" + converts + n + text);
show("object last", n => text + "s" + n + converts);
show("object behind a member", n => "s" + point.x + converts + list.length);
show("object behind a call", n => "s" + same(n) + converts + same(n));
show("object behind literals", n => n + "s" + 2.5 + "t" + converts);
show("object in front of literals", n => "s" + converts + 1 + "t");
show("no text in front", n => n + point.x + converts + "s");
show("product first", n => n * point.x + "s" + converts);
show("typeof as the text", n => typeof n + converts + n);
show("template swallows the text", n => n + "s" + `${n}` + converts);
show("template first", n => `${n}` + "s" + converts);
show("sum in parentheses", n => n + ("s" + converts) + text);
show("sum in parentheses is the text", n => n + ("s" + n) + converts);
show("sum below a product", n => (n + "s" + converts) * 2);
show("sum as an argument", n => same(n + "s" + converts));
show("sum as an element", n => [n + "s" + converts]);
show("symbol last", n => text + "s" + sign);
show("symbol in front of literals", n => "s" + sign + "t");

show("local += object", n => {
  n += converts;
  return n;
});
show("local += member then object", n => {
  n += point.x && converts;
  return n;
});
show("local += object or literal", n => {
  n += converts || 3;
  return n;
});
show("local += object or literal or more", n => {
  n += converts || 3 || list.length || typeof n;
  return n;
});
show("local += bigint ?? call ?? literal", n => {
  n += big ?? same(n) ?? "s";
  return n;
});
show("local += product", n => {
  n += point.x * converts;
  return n;
});
show("local += text sum", n => {
  n += "s" + converts;
  return n;
});
show("local += sum with text", n => {
  n += point.x + "s" + converts + list.length;
  return n;
});
show("local -= symbol", n => {
  n -= sign;
  return n;
});
show("captured += object", n => {
  const read = () => n;
  n += point.x && converts;
  return read();
});
let atTheTop = 1;
show("variable of the module += object", () => {
  atTheTop += point.x && converts;
});
show("member += object", () => {
  point.x += list.length && converts;
});
show("element += object", () => {
  list[0] += point.y && converts;
});
show("member += literal", () => {
  const holder = { converts };
  holder.converts += 1;
});

show("missing as an argument", n => same(missing));
show("missing as the last argument", n => same(n, missing));
show("missing as the first argument", n => same(missing, n));
show("missing at the end of an argument", n => same(n + 1 + missing));
show("missing in parentheses", n => same((n + missing) * 2));
show("missing as an element", n => [missing]);
show("missing at the end of an element", n => [n, n * missing]);
show("missing in new", n => new Date(missing));
show("missing alone", n => {
  return n + missing;
});
show("object as the last element", n => [text + "s" + n + converts]);

show("void first in a function", function (n) {
  void ((n + 1) * converts);
});
show("void first in an arrow function", n => {
  void ((list.length !== typeof n) + converts);
});
show("void as a value", n => void ((n + 1) * converts));
show("minus in front of parentheses", n => -((n + 1) * converts));

show("true literal &&", n => same(1 && point.y && (3 >= -n) <= converts));
show("false literal ||", n => same(0 || (point.y && n * converts)));
show("null ??", n => same(null ?? n * converts));
show("negation ??", n => (-n ?? same(n)) ^ sign);
show("literals of two types", n => (3 & "s" & n) | converts);
show("typeof in front of a comma", n => ((typeof n, 1) & sign) | n);

show("template of a symbol", n => `${sign}`);
show("template of a literal && symbol", n => `${3 && sign}`);
show("template of a symbol || member", n => `${sign || list[0]}`);
show("template of a member", n => `${point.x}${{ converts }.converts}`);
show("template that starts with parentheses", n => `${(n || list[0]) | converts}`);
show("second substitution starts with parentheses", n => `${n}${(n || list[0]) | converts}`);
