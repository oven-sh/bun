function target() {
  console.log(typeof this, this === undefined);
}
new Proxy(target, {})();
