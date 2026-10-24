export function read() {
  return late;
}
try {
  console.log("a", read());
} catch (error) {
  console.log("a", error.constructor.name);
}
export const late = "late of a";
console.log("a", read());
