function target() {
  return { made: 1.5 };
}
const result = new Proxy(target, {})();
console.log(typeof result, result.made + 1);
