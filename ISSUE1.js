// crash at env_loader.zig:386 'errdefer allocator.free(e_strings);' - likely the wrong allocator is used?
// to reproduce, `bun a.js --inspect`

await Bun.sleep(100);

setInterval(() => {
  for (let i = 0; i < 4096 * 2; i++) {
    console.log(1 + 1);
  }
}, 100);
