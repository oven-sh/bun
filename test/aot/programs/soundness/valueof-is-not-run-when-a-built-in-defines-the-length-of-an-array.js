function define() {
  const length = { valueOf() { console.log("valueOf runs"); return 3; } };
  Object.defineProperty([], "length", { value: length });
}
try { define(); } catch (error) { console.log(String(error)); }
