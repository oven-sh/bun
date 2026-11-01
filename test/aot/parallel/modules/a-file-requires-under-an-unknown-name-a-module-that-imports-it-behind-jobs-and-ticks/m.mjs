import "./x.cjs";
export const f = () => 1;
console.log("m runs");
queueMicrotask(() => console.log("job of m"));
