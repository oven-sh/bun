const meta = import.meta;
meta.dir = meta.dir + "/other";
export default (await import(import.meta.dir + "/a.js")).default;
