export const seen = ["ws" in require.cache, Object.keys(require.cache).includes("ws")].join(" ");
