import.meta.dir = import.meta.dir + "/other";
const name = ["a"].join("");
export default (await import(import.meta.dir + "/" + name + ".js")).default;
