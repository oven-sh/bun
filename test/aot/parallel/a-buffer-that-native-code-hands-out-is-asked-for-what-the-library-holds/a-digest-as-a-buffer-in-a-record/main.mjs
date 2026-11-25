console.log(JSON.stringify({ sum: Bun.MD5.hash("a", "buffer") }).slice(0, 24));
