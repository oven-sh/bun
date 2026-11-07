const swap = (made) => class extends made {};
const seen = [];
const note = (value) => { seen.push(value); return () => {}; };
const attempt = (run) => { try { return typeof run(); } catch (error) { return error.name; } };

@swap class Kit {
  @note(attempt(() => eval("Kit"))) field = 1;
  @note(attempt(() => eval("Kit = 5"))) other = 1;
  static [(seen.push(attempt(() => eval("Kit")), typeof Kit), "key")] = 2;
  static written() { return eval("Kit"); }
  static decorated() { return Kit; }
  static poke() { return attempt(() => eval("Kit = 5")); }
}
console.log(seen.join(), Kit.key);
console.log(Kit.written() === Kit, Kit.decorated() === Kit, Object.getPrototypeOf(Kit) === Kit.written(), Kit.poke(), typeof Kit);
