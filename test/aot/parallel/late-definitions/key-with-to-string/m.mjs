const key = { toString() { console.log("toString runs"); return "m"; } };
class A { [key]() { return 1; } }
export const read = () => A;
