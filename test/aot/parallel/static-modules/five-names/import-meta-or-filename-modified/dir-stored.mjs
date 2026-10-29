import.meta.dir = import.meta.dir + "/other";
export default (await import(import.meta.dir + "/a.js")).default;
