// Exports of start-up modules and stores into the realm: the engine calls Error.prepareStackTrace with an error that native code made, and what it returns becomes `stack`, whatever lib.d.ts says.
class Failure extends Error {
  code = 7;
}

let total = 0;

function format(error: Failure, sites: NodeJS.CallSite[]): any {
  total += typeof error.code === "number" ? error.code : 1000;
  total += Array.isArray(sites) ? 10000 : 0;
  total += sites.length > 0 && typeof sites[0].getLineNumber() === "number" ? 100000 : 0;
  return sites.length > 0 ? 5 : 6;
}

format(new Failure("mine"), []);
Error.prepareStackTrace = format as (error: Error, sites: NodeJS.CallSite[]) => any;

function stackOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return (error as Error).stack;
  }
  return "none";
}

const nothing: any = null;
for (const run of [() => nothing.x, () => JSON.parse("{"), () => new Array(-1), () => { throw new Failure("own"); }]) {
  const stack = stackOf(run);
  total += typeof stack === "string" ? 1000000 : typeof stack === "number" ? 10000000 * stack : 0;
}
console.log(total);
