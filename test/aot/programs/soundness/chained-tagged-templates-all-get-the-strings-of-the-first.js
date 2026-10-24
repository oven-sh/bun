const seen = [];
function tag(strings, ...values) { seen.push(strings.raw.join("|") + ":" + values.join()); return tag; }
tag`Hello``New``World`;
tag`a${1}b``c${2}d${3}e`;
console.log(seen.join(" "));
