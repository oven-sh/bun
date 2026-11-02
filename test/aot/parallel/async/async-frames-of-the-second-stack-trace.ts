const settled = Promise.resolve(0);
const names = (error: Error) => error.stack!.split("\n").slice(1).map(line => line.trim().replace(/ ?\(?[^ (]*:\d+:\d+\)?$/, "")).join(" | ");
async function makesLater(): Promise<Error> {
  await settled;
  return new Error("later");
}
async function outer(): Promise<Error> {
  return await makesLater();
}
for (let round = 0; round < 2; round++) console.log(names(await outer()));
