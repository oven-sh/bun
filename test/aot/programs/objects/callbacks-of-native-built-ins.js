// A closure handed to a built-in that native code implements is called by native code.
const lines = [];
function printer(label) {
  return (...values) => {
    let text = label + ":";
    for (let i = 0; i < values.length; i++) text += " " + String(values[i]);
    lines.push(text);
  };
}

{
  const print = printer("finalization");
  const o = { valueOf: (a, b) => 5 };
  print(o + 1);
}
{
  const print = printer("map-foreach");
  const t = new Uint8Array(2);
  t.forEach((v, i) => print(i));
}
{
  const print = printer("getter-defined");
  const t = {};
  Object.defineProperty(t, "x", { get: () => 44 });
  print(t.x);
}
{
  const print = printer("proxy-get");
  print(new Proxy({}, { get: () => 42 }).x);
}
{
  const print = printer("arrow-none");
  print(JSON.parse('1', () => 5));
}
{
  const print = printer("arrow-three");
  print(JSON.parse('{"a":1}', (k, v, c) => typeof v === "number" ? v + 1 : v).a);
}
{
  const print = printer("arrow");
  print(JSON.parse('{"a":1}', (k, v) => typeof v === "number" ? v + 1 : v).a);
}
{
  const print = printer("declaration");
  function revive(k, v) { return typeof v === "number" ? v + 1 : v; }
  print(JSON.parse('{"a":1}', revive).a);
}
{
  const print = printer("function");
  print(JSON.parse('{"a":1}', function (k, v) { return typeof v === "number" ? v + 1 : v; }).a);
}
{
  const print = printer("this");
  print(JSON.parse('{"a":1}', function (k, v) { return k === "" ? v : typeof this; }).a);
}
{
  const print = printer("replacer");
  print(JSON.stringify({ a: 1 }, (k, v) => typeof v === "number" ? v + 1 : v));
}
{
  const print = printer("then-extra");
  async function g() { return 4; }
  g().then(() => print("no parameter"));
}
{
  const print = printer("then");
  async function g() { return 4; }
  g().then(v => print(v));
}

await new Promise(resolve => setTimeout(resolve, 0));
console.log(lines.join("\n"));
