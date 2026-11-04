// a text of the greatest length is joined with one character for a test of a start and of an end: the join throws, whatever the test would have answered
function twice(text: string) {
  return text + text;
}
function longest() {
  const powers = ["a"];
  for (let k = 1; k < 31; k++) powers.push(twice(powers[k - 1]));
  let text = "";
  for (let k = 0; k < 31; k++) text = powers[k] + text;
  return text;
}
function under(path: string, dir: string, n: number) {
  let c = 0;
  for (let i = 0; i < n; i++) if (path.startsWith(dir + "/")) c++;
  return c;
}
function named(name: string, extension: string) {
  return name.endsWith("." + extension);
}
function tell(f: () => unknown) {
  try {
    return String(f());
  } catch (error) {
    return (error as Error).name;
  }
}
function deed(text: string) {
  return [tell(() => under("a/b", text, 1)), tell(() => under("a/b", text, 0)), tell(() => named("b.a", text)), tell(() => under("a/b", "a", 2)), tell(() => named("b.a", "a"))].join(" ");
}
const text = longest();
console.log(text.length);
console.log(deed(text));
for (let i = 0; i < 20; i++) deed(text);
console.log(deed(text));
