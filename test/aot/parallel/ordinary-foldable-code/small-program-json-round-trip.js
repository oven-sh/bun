const RAW = '{"name":"app","tags":["a","b"],"nested":{"n":1,"ok":true,"none":null}}';
const parsed = JSON.parse(RAW);
const again = JSON.stringify(parsed);
console.log(again === RAW, parsed.tags.length, parsed.nested.none, JSON.stringify(parsed, null, 1).split("\n").length);
