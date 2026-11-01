// The names are put together at run time, and at last the program puts a function of its own in the place of fetch.
const join = (...parts) => parts.join("");
const refused = async call => {
  try {
    await call();
  } catch (error) {
    console.log(error.name, error.code, error.message);
  }
};
await refused(() => fetch[join("pre", "connect")](""));
await refused(() => globalThis[join("fe", "tch")](""));
await refused(() => Bun[join("fe", "tch")][join("pre", "connect")](""));
console.log({ ...fetch });
globalThis.fetch = () => "mine";
console.log(fetch(), typeof fetch.preconnect, typeof Bun.fetch.preconnect);
