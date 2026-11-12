import.meta.dir = import.meta.dir + "/other";
export default (await import(__dirname + "/a.js")).default;
