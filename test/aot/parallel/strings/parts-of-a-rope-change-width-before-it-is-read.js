// A string that becomes a key takes the characters of the name, whatever their width. So a part of a rope, or the base of a slice in it, may change width between the join and the first read.
const parsed = JSON.parse(
  '{"note":"a — b","file":"/srv/app/src/index.ts","word":"alpha/beta/gamma/delta","short":"a/b"}',
);
const names = { [parsed.file]: "file", [parsed.word]: "word", [parsed.short]: "short" };
const copyOf = text => text.split("/").join("/");
const unitsOf = text => {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
  return sum;
};

function sliceThenKey(text) {
  const out = text.slice(0, text.lastIndexOf("/")) + ".js";
  const hit = names[text];
  return [unitsOf(out), hit, out];
}
function flatThenKey(text) {
  const out = text + ".js";
  const hit = names[text];
  return [unitsOf(out), hit, out];
}
function threeThenKey(text) {
  const out = "<" + text + text.slice(1, 3);
  const hit = names[text];
  return [unitsOf(out), hit, out];
}
function twoSlicesThenKey(text) {
  const out = text.slice(2) + text.slice(0, 2);
  const hit = names[text];
  return [unitsOf(out), hit, out];
}
function keyThenJoin(text) {
  const hit = names[text];
  const out = text.slice(1) + text;
  return [unitsOf(out), hit, out];
}
function endsWithAfterKey(text) {
  const out = text.slice(0, text.lastIndexOf("/")) + "/x.js";
  const hit = names[text];
  return [out.endsWith("/x.js"), hit, out];
}

for (let round = 0; round < 3; round++) {
  for (const name of ["file", "word", "short"]) {
    for (const check of [sliceThenKey, flatThenKey, threeThenKey, twoSlicesThenKey, keyThenJoin, endsWithAfterKey])
      console.log(check.name, JSON.stringify(check(copyOf(parsed[name]))), JSON.stringify(check(parsed[name])));
  }
}
