// The strings the raw strings and the lengths of a tagged template.
function tag(strings, v) {
  return strings[0] + v;
}
console.log(tag`-${5}`);
function raw(strings) {
  return strings.raw[0] + strings.length + strings.raw.length;
}
console.log(raw`a\n${1}b`);
