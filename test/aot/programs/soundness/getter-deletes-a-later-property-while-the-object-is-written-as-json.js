// The getter of the first property deletes the last one while JSON.stringify walks the object.
"use strict";
const print = text => console.log(text);
let count = 0;
let trail = "";
function note(text) {
  count++;
  trail += text + "; ";
}
function str(v) {
  if (typeof v === "string") return '"' + v + '"';
  if (typeof v === "function") return "function";
  if (typeof v === "symbol") return "symbol";
  if (typeof v === "bigint") return v + "n";
  if (typeof v === "object" && v !== null) return "object";
  if (v === 0 && 1 / v < 0) return "-0";
  return "" + v;
}
function saysWhereItWasMade(key) {
  return (
    key === "line" ||
    key === "column" ||
    key === "sourceURL" ||
    key === "stack" ||
    key === "originalLine" ||
    key === "originalColumn"
  );
}
function shortened(text) {
  if (text.length <= 400) return text;
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
  return text.slice(0, 150) + " .. " + text.length + " characters, sum " + sum + " .. " + text.slice(-150);
}
function listed(items) {
  let text = "";
  let size = 0;
  for (let i = 0; i < items.length; i++) {
    if (saysWhereItWasMade(items[i])) continue;
    text += (size++ ? "," : "") + String(items[i]);
  }
  return shortened(size + " [" + text + "]");
}
class A {
  a = 1;
  k = 2;
  z = 3;
  m() {
    return "m";
  }
}
function make() {
  return new A();
}
function run() {
  let seen, before, line;
  const o = make();
  let isDone = false;
  Object.defineProperty(o, "a", {
    get() {
      if (!isDone) {
        isDone = true;
        try {
          note("deleted " + delete o.z);
        } catch (e) {
          note("the change threw " + e.name);
        }
      }
      return 1;
    },
    enumerable: true,
    configurable: true,
  });
  before = count;
  try {
    seen = shortened(str(JSON.stringify(o)));
  } catch (e) {
    seen = "threw " + e.name;
  }
  line = seen + " | " + (count - before) + " " + trail;
  trail = "";
  print("during" + ": " + line);
  before = count;
  try {
    seen = shortened(str(JSON.stringify(o)));
  } catch (e) {
    seen = "threw " + e.name;
  }
  line = seen + " | " + (count - before) + " " + trail;
  trail = "";
  print("after" + ": " + line);
}
try {
  run();
} catch (e) {
  print("run threw " + e.name);
}
print("end: " + count + " " + trail);
