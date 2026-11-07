function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (ArrayBuffer.isView(value)) return value.constructor.name + "<" + Array.prototype.join.call(value, " ") + ">";
  let text;
  try {
    text = String.prototype.valueOf.call(value);
  } catch {
    const parts = [];
    for (const key of Reflect.ownKeys(value)) parts.push(String(key) + ": " + show(value[key]));
    return "{" + parts.join(", ") + "}";
  }
  return "String object " + JSON.stringify(text);
}

function attempt(label, run) {
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + " -> " + line);
}

function make(text) {
  return (0, eval)("(" + text + ")");
}

const written = {
  1: "1",
  2.0: "2.0",
  0x10: "0x10",
  0b11: "0b11",
  0o17: "0o17",
  1e2: "1e2",
  1_000: "1_000",
  0.5: "0.5",
  .25: ".25",
  5.: "5.",
  1e21: "1e21",
  1e-7: "1e-7",
  123456789012345680000: "123456789012345680000",
  0.1: "0.1",
  9007199254740993: "9007199254740993",
  4294967295: "4294967295",
  4294967296: "4294967296",
  7n: "7n",
  0xffn: "0xffn",
};

attempt("the keys of the literal", () => Object.keys(written));

function read(key) {
  return written[key];
}

for (let i = 0; i < 2000; i++) read("1");

const keys = ["1", "'1'", "1.0", "2", "'2'", "'2.0'", "16", "'16'", "'0x10'", "0x10", "3", "15", "100", "'100'", "'1e2'", "1e2", "1000", "'1_000'", "0.5", "'0.5'", "'.5'", "0.25", "'.25'", "'0.25'", "5", "'5.'", "1e21", "'1e21'", "'1e+21'", "1e-7", "'1e-7'", "'1e-07'", "123456789012345680000", "'123456789012345680000'", "123456789012345678901", "0.1", "0.1 + 0", "0.30000000000000004 - 0.2", "9007199254740992", "9007199254740993", "'9007199254740993'", "'9007199254740992'", "4294967295", "4294967296", "7", "7n", "'7'", "'7n'", "255", "255n"];
for (const key of keys) attempt("written[" + key + "]", () => read(make(key)));

attempt("literal reads", () => [written[1], written[1.0], written["1"], written[0x10], written[16], written[1e2], written[1_0_0], written[.5], written[5.], written[7n], written[0.1 + 0.2 - 0.2]]);
attempt("later keys win", () => JSON.stringify({ 1: "a", "1": "b", 1.0: "c", 0x1: "d", 1n: "e" }));
attempt("order of number-like keys", () => Object.keys({ b: 1, 10: 1, 9: 1, "08": 1, 1.5: 1, "-1": 1, a: 1, 0: 1, 4294967294: 1, 4294967295: 1, 1e3: 1 }));
attempt("class members", () => {
  class Numbered {
    1() { return "one"; }
    0x10() { return "sixteen"; }
    1e3() { return "thousand"; }
    static 2 = "static two";
    3 = "field three";
    get 4() { return "getter four"; }
    .5() { return "half"; }
  }
  const made = new Numbered();
  return [made[1](), made["16"](), made[1000](), Numbered["2"], made[3], made["4"], made["0.5"](), Object.getOwnPropertyNames(Numbered.prototype), made[1].name, made[16].name];
});
attempt("patterns", () => {
  const { 1: one, 0x10: sixteen, 1e2: hundred, 0.5: half, 7n: seven } = written;
  return [one, sixteen, hundred, half, seven];
});
attempt("lists and number-like keys", () => {
  const list = ["zero", "one", "two"];
  return [list[1.0], list[0x1], list[1e0], list["1"], list[1n], list["1.0"], list["0x1"], list["1e0"], list[-0], list["-0"], list[0.5 + 0.5], list[2 - 1e-17]];
});
attempt("texts and number-like keys", () => ["abc"[1.0], "abc"[0x1], "abc"["1"], "abc"[1n], "abc"["1.0"], "abc"[-0], "abc"["-0"], "abc"[1e0]]);
attempt("numbers turned into texts", () => [String(1e21), String(1e-7), String(123456789012345680000), String(0.000001), String(1e-6), String(-1e-7), String(100), String(1e2), String(0.1 + 0.2), String(2 ** 53), String(-0), String(5e-324), String(1.7976931348623157e308), String(4.35), String(0.5e1), (25).toString(2), (255).toString(16), (0.5).toString(2), (-255).toString(36)]);
