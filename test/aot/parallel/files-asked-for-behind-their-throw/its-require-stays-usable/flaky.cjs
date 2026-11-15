console.log("flaky runs", laters.length);
laters.push((load => () => load("./value.cjs").value)(require));
(function () {
  const load = typeof require == "function" && require;
  laters.push(() => load("./value.mjs").value);
})();
if (laters.length < 6) throw new Error("flaky threw");
