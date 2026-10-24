// An object with a protocol method arrives late where a string or a regular expression was.
function main() {
  let separator = ",";
  const out = [];
  const custom = { [Symbol.split](text, limit) { return [{ custom: text.length }]; } };
  for (let i = 0; i < 2; i++) { out.push(typeof "a,b".split(separator)[0]); separator = custom; }
  console.log(out.join());
  let matcher = /a/;
  const own = { [Symbol.match](text) { return { matched: text }; }, [Symbol.search]() { return "found"; }, [Symbol.replace](text, by) { return { replaced: by }; } };
  for (let i = 0; i < 2; i++) {
    const m = "abc".match(matcher);
    console.log(typeof m.matched, typeof "abc".search(matcher), typeof "abc".replace(matcher, "z"));
    matcher = own;
  }
  let part = "b";
  const convertible = { toString() { part = 5; return "c"; } };
  const found = [];
  for (let i = 0; i < 3; i++) { found.push("abc5".indexOf(part)); if (!i) part = convertible; }
  console.log(found.join());
  let number = 2;
  const boxed = { valueOf() { return 3; } };
  const powers = [];
  for (let i = 0; i < 2; i++) { powers.push(Math.pow(number, 2), Math.floor(number), Math.max(number, 1)); number = boxed; }
  console.log(powers.join());
}
main();
