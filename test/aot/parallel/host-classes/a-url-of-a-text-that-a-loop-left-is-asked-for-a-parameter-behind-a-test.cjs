// As beside it, without a handler: the question stands in a later block than `new URL`.
// STATISTIC: URLsLeftUnbuilt >= 1
const data = JSON.parse('{"rows":[["https://a.example/z?d=e"],["https://a.example/z?d=e","https://a.example/c?d=f%20g"],["x","y","https://a.example/?q=1&d=%E2%82%AC"]],"name":"d"}');
function read(texts, name) {
  let text = "https://a.example/";
  for (let i = 0; i < texts.length; i++) text = texts[i];
  const url = new URL(text);
  if (texts.length > 1) return url.searchParams.get(name);
  return "none";
}
globalThis.handed = [read];
for (const row of data.rows) console.log(read(row, data.name), read(row, "absent"));
