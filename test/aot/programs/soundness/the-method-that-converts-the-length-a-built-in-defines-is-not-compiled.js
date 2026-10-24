function define() {
  const length = { valueOf() { console.log("valueOf runs"); return 3; } };
  Reflect.defineProperty([], "length", { value: length });
  Object.defineProperties([], { length: { value: length } });
}
try { define(); } catch (error) { console.log(String(error)); }
