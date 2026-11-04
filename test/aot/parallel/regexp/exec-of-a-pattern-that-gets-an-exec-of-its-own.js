// a pattern that has been run three hundred times gets an `exec` of its own, through a function that the build cannot name
const hidden = JSON.parse('{"define":"defineProperty","remove":"deleteProperty"}');
function ran(pattern, text) {
  const found = pattern.exec(text);
  return found === null ? "null" : typeof found === "object" ? found.join("|") + "@" + found.index : String(found);
}
function deed(pattern) {
  Reflect[hidden.define](pattern, "exec", { value: text => "its own exec of " + text, configurable: true });
}
const pattern = /b(c+)/;
console.log(ran(pattern, "abccd"));
let hits = 0;
for (let i = 0; i < 300; i++) if (ran(pattern, "a" + i + "bc") !== "null") hits++;
console.log(String(hits));
deed(pattern);
console.log(ran(pattern, "abccd"));
for (let i = 0; i < 3; i++) console.log(ran(pattern, "turn " + i));
Reflect[hidden.remove](pattern, "exec");
console.log(ran(pattern, "abccd"));
console.log(ran(/b(c+)/, "abccd"));
