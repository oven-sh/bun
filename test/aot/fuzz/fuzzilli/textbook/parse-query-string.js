function parsed(query) {
  const out = {};
  for (const part of query.split("&")) {
    const [key, value] = part.split("=");
    out[key] = value;
  }
  return out;
}
const query = parsed(JSON.parse('"page=2&sort=name"'));
console.log(query.page, query.sort, JSON.stringify(query));
