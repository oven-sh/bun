const folder = import.meta.dir;
delete import.meta.dir;
import.meta["dir"] = folder + "/other";
export default (await import(import.meta.dir + "/a.js")).default;
