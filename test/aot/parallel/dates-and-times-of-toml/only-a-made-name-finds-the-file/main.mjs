// No site names the file: the build finds it below the folder, and it loads as it does in plain Bun.
const name = ["dated.toml", "none.toml"][Date.now() > 0 ? 0 : 1];
const { default: data } = await import("./data/" + name);
console.log(typeof data.day, String(data.day), data.day.month);
