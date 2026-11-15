Object.defineProperty(import.meta, "dir", { value: import.meta.dir + "/other" });
export default (await import(import.meta.dir + "/a.js")).default;
