export default async function* () {
  await null;
  yield new Error("here").stack
    .split("\n")[1]
    .trim()
    .replace(/\(.*[\/\\]/, "(");
}
