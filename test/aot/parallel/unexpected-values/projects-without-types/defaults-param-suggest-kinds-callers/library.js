export function next(n = 0) {
  return n + 1;
}
export function half(n = 10) {
  return n / 2;
}
export function bits(n = 0) {
  return n | 0;
}
export function size(list = []) {
  return list.length;
}
export function appended(list = [], item = 0) {
  list.push(item);
  return list;
}
export function shout(text = "") {
  return text.toUpperCase();
}
export function glued(text = "", more = "") {
  return text + more;
}
export function chosen(flag = false) {
  return flag ? "yes" : "no";
}
export function negated(flag = false) {
  return !flag;
}
export function width(options = {}) {
  return options.width;
}
export function area({ width = 1, height = 1 } = {}) {
  return width * height;
}
export function first([head = 0] = []) {
  return head + 1;
}
export function called(callback = () => 0) {
  return callback() + 1;
}
export function repeated(text = "ab", times = 2) {
  let out = "";
  for (let i = 0; i < times; i++) out += text;
  return out;
}
export function nothing(value = null) {
  return value === null;
}
