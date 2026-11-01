// import() loads a graph while nobody looks on. The first module of the graph calls import() on the second before the second has begun, the second on the root, and the root on the first.
// A chain of jobs shows in which turn each of the three promises settles.
await import("./root.mjs");
