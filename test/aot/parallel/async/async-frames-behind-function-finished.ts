// Async frames behind a function that finished before.
const settled = Promise.resolve(0);
const frames = (error: Error) => String(error.stack).split("\n").slice(1).map(line => line.trim().replace(/\(?\S*[\\/]/, "")).join(" | ");
async function makesLater(): Promise<Error> {
  await settled;
  return new Error("later");
}
async function inner(which: number): Promise<Error> {
  if (which === 1) return await makesLater();
  return new Error("other");
}
async function outer(which: number): Promise<Error> {
  return await inner(which);
}
for (let which = 0; which < 2; which++) console.log(frames(await outer(which)));
