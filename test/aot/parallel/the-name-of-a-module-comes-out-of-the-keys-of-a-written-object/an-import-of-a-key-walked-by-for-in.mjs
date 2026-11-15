const uses = { zlib: found => typeof found.gzipSync, querystring: found => found.stringify({ a: 1 }) };
for (const name in uses) console.log(name, uses[name](await import(name)));
