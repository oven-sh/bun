export default function named() {
  return new Error("here").stack
    .split("\n")[1]
    .trim()
    .replace(/\(.*[\/\\]/, "(");
}
