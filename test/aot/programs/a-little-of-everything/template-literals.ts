// Template literals and tagged templates: the strings, the raw strings, the values.
const name = "world";
const count = 3;
console.log(`hello ${name}, ${count + 1} times${count > 1 ? "!" : ""}`);
console.log(`multi
line ${`nested ${name}`}`);
let lastStrings: TemplateStringsArray | undefined;
function tag(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.raw.join("|") + values.join(",") + (strings === lastStrings ? " same" : " new");
}
function once() {
  return ((strings: TemplateStringsArray) => {
    const same = strings === lastStrings;
    lastStrings = strings;
    return same;
  })`x`;
}
console.log(tag`a${1}b\n${2}c`, once(), once());
console.log(String.raw`\n${1}`, `${{ toString: () => "object" }}`, `${[1, 2]}`, `${null} ${undefined}`);
