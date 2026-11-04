// texts that are written are joined, narrow ones beside wide ones, and pieces are cut out of what comes of it
function narrow() { return `${2}-${"p" + "x"}`; }
function mixed() { return "ab" + "中" + "cd"; }
function wide() { return "中" + "文"; }
function withOthers() { return `${undefined}|${null}|${true}|${-0}|${1.5}|${1e21}|${""}`; }
function deed(make) {
  const text = make();
  return [text, text.length, text.slice(0, 2), text.slice(1), text.charCodeAt(2), text === make(), JSON.stringify(text[text.length - 1])].join(" ");
}
for (let turn = 0; turn < 3; turn++) {
  console.log(deed(narrow));
  console.log(deed(mixed));
  console.log(deed(wide));
  console.log(deed(withOthers));
}
