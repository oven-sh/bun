// As many clients keep it: bound to the global object, or called through call and apply. The function is followed to each call.
// STATISTIC: ImageFunctionsEmitted <= 80
const refused = async call => {
  try {
    await call();
  } catch (error) {
    console.log(error.name, error.message);
  }
};
const bound = fetch.bind(globalThis);
const client = { fetch: fetch.bind(undefined), plain: fetch };
await refused(() => bound(""));
await refused(() => client.fetch(""));
await refused(() => client.plain(""));
await refused(() => fetch.call(null, ""));
await refused(() => fetch.apply(null, [""]));
await refused(() => Reflect.apply(fetch, null, [""]));
await refused(() => Bun.fetch.bind(null)(""));
console.log(bound.name, bound.length);
