// The class stands inside a function, the instance is captured, and the reader runs in a nested function.
const log: string[] = [];
async function stretch(round: number): Promise<void> {
  class Other extends Array<number> { static get [Symbol.species](): any { log.push("getter " + round); return Array; } }
  const other = new Other();
  const read = () => other.map(one => one);
  await null;
  log.push(String(read().length));
}
stretch(1).then(() => stretch(2)).then(() => console.log(log.join("; ")));
