async function inner() {
  await null;
  throw new Error("inner");
}
export default async function () {
  await inner();
}
