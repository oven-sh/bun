function F() {}
const bound = F.bind(null);
Object.defineProperty(bound, "prototype", { get() { console.log("getter runs"); return F.prototype; } });
class B extends bound {}
export const read = () => B;
