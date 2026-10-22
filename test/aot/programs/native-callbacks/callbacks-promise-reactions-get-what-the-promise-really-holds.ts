// Callbacks handed over: a reaction is called with whatever the promise was settled with: a string under the type number, nothing for finally, a native error for catch; the program's own calls pass numbers.
export {};

let total = 0;

function double(value: number): number {
  total += typeof value === "number" ? 1 : typeof value === "string" ? 100 : value === undefined ? 10000 : 1000000;
  return value * 2;
}

double(1);
const results: unknown[] = [
  await Promise.resolve(2).then(double),
  await Promise.resolve(JSON.parse('"3"') as number).then(double),
  await new Promise<number>(resolve => setTimeout(resolve, 1, "4")).then(double),
  await new Promise<number>(resolve => (resolve as any)()).then(double),
  await Promise.resolve(5).finally(double as any),
  await Promise.reject(6).catch(double),
  await new Response("{").json().catch(double),
  await Promise.reject("7").then(undefined, double),
  await Promise.all([8, "9" as any]).then(([a, b]) => double(a) + double(b)),
];
console.log(total, results.join());
