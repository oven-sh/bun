// Three modules that one program loads by a table of import() calls. The first reads a member of a global that nothing declares, in a function that never runs,
// and throws a ReferenceError before that. Built together they once stopped a verifier of the compiler: "a slot access names a field that has no slot".
const programs = {
  0: () => import("./p0.js"),
  1: () => import("./p1.js"),
  2: () => import("./p2.ts"),
};
for (const key of [1, 2, 0]) {
  try {
    await programs[key]();
    console.log(key, "loaded");
  } catch (error) {
    console.log(key, "threw", error.name);
  }
}
