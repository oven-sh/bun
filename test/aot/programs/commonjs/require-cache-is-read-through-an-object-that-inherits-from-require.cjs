// An object that inherits from `require` goes behind a Proxy or to a function that the compiler cannot follow. Whoever gets it back reads `cache`, `extensions` and `resolve` under computed keys.
const unknown = globalThis[["Obj", "ect"].join("")];
const computed = text => text.split("").join("");
const holders = {
  proxyOfHeir: new Proxy(Object.create(require), {}),
  heirHandedBack: unknown(Object.create(require)),
};
for (const [name, holder] of Object.entries(holders)) {
  console.log(
    name,
    typeof holder[computed("cache")],
    typeof holder[computed("extensions")],
    typeof holder[computed("resolve")],
  );
}
