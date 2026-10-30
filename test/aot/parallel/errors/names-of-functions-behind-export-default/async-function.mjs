export default async function () {
  await null;
  return new Error("here").stack
    .split("\n")[1]
    .trim()
    .replace(/\(.*[\/\\]/, "(");
}
