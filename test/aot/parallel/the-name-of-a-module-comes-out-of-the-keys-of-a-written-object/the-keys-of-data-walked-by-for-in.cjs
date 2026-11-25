const table = { zlib: 1, querystring: 2, os: 3 };
for (const name in table) {
  const found = require(name);
  console.log(name, typeof found, Object.keys(found).length > 1);
}
