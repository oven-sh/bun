for (let i = 0; i < 3; i++) {
  try { Object.defineProperty(exports, "fixed", { value: i }); exports["ok" + i] = true; } catch (e) { exports["error" + i] = e.constructor.name; }
  Object.defineProperty(exports, "open", { value: i, configurable: true });
  Object.defineProperty(exports, "getter", { get() { return i; }, configurable: true, enumerable: true });
}
