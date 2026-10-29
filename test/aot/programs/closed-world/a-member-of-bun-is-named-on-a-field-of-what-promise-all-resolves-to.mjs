// Bun goes to a function that is picked at run time, and a store under a key that is picked at run time may replace any global, before the member is named.
const hide = globalThis[process.argv[2] ?? "Boolean"];
globalThis[process.argv[3] ?? "nothing"] = hide(1);
hide(Bun);
const url = "postgres://127.0.0.1:1/x";
const holder0 = {
  next: async () => {
    const bun = (await Promise.all([{ b: Bun }]))[0].b;
    return typeof new bun.SQL(url);
  },
};
console.log(await holder0.next());
