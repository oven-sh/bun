const second = import("./conf.toml", { with: { type: "text" } });
const first = import("./inner.mjs");
const [{ port }, loaded] = await Promise.all([first, second]);
console.log(port, typeof loaded.default);
