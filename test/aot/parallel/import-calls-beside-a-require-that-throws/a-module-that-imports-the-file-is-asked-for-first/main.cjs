// Nobody calls import() of the file itself: two modules import it, its text comes once, and no text comes behind the throw.
(async () => {
  const settled = await Promise.allSettled([import("./user.mjs"), import("./user2.mjs")]);
  console.log(settled.map((each) => each.reason.message).join(", "));
  try { console.log("required", require("./flaky.cjs").value); } catch (error) { console.log("require threw", error.message); }
  console.log("runs", globalThis.runs);
})();
