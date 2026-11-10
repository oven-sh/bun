async function late() { const ns = await import("./index.mjs"); return typeof ns.env; }
  console.log("SAID", typeof late);
