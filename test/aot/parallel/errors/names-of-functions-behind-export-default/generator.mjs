export default function* () {
  yield new Error("here").stack
    .split("\n")[1]
    .trim()
    .replace(/\(.*[\/\\]/, "(");
}
