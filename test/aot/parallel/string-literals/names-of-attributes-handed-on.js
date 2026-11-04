// The name of an attribute is a text that the program spells, or the key of a walk over an object, and is handed on through two functions into a list.
function pushStringAttribute(target, name, value) {
  "function" != typeof value && "symbol" != typeof value && "boolean" != typeof value && target.push(" ", name, '="', String(value), '"');
}
function pushAttribute(target, name, value) {
  switch (name) {
    case "className":
      pushStringAttribute(target, "class", value);
      break;
    case "tabIndex":
      pushStringAttribute(target, "tabindex", value);
      break;
    case "dir":
    case "role":
    case "viewBox":
    case "width":
    case "height":
      pushStringAttribute(target, name, value);
      break;
    case "style":
      break;
    default:
      if (name.length > 2 && (name[0] === "o" || name[0] === "O") && (name[1] === "n" || name[1] === "N")) break;
      pushStringAttribute(target, name.toLowerCase() === name ? name : name.toLowerCase(), value);
  }
}
function render(type, props) {
  const target = ["<", type];
  for (const key in props) if (Object.prototype.hasOwnProperty.call(props, key)) pushAttribute(target, key, props[key]);
  target.push(">");
  return target.join("");
}
const elements = [
  ["div", { className: "a", id: "b", "data-x": "c" }],
  ["svg", { viewBox: "0 0 1 1", width: 1, height: 2, role: "img" }],
  ["a", { href: "/x", tabIndex: 0, onClick() {}, dir: "ltr" }],
  ["meta", JSON.parse('{"charSet":"utf-8","name":"viewport","content":"width=device-width"}')],
  ["p", Object.fromEntries([["lang", "en"], ["da" + "ta-y", 1]])],
];
let out = "";
for (let round = 0; round < 50; round++) for (const [type, props] of elements) out = round ? out : out + render(type, props);
console.log(out);
