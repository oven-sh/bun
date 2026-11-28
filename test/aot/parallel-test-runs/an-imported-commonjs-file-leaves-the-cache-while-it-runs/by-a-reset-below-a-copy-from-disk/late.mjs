const h = await import("./h.cjs"),
  e = await import("./early.cjs");
console.log("late", h.v, e.v);
