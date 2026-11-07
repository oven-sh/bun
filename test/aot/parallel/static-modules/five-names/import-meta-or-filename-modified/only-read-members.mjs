const seen = [import.meta.url, import.meta["path"], import.meta.env.HOME, import.meta.resolve("./a.js"), typeof import.meta.main];
export default seen.length === 5 && (await import(import.meta.dir + "/a.js")).default;
