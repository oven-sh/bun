import * as forms from "./forms";
for (const [name, fn] of Object.entries(forms)) {
  let out;
  try {
    const { onClick, children } = fn({ a: 1 }).props;
    let called;
    try { called = typeof onClick === "function" ? onClick() : "-"; } catch (e) { called = "call threw " + e.constructor.name; }
    out = [typeof onClick, children, called].join(" ");
  } catch (e) {
    out = "threw " + e.constructor.name + ": " + e.message;
  }
  console.log(name.padEnd(22), out);
}
