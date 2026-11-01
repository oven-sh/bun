const key = () => { console.log("key runs"); return "m"; };
class A { [key()]() { return 1; } }
export const read = () => A;
