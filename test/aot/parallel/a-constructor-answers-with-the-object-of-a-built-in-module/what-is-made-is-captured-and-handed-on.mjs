import path from "node:path";
function attempt(label, ask) {
  try {
    console.log(label, String(ask()));
  } catch (error) {
    console.log(label, error.name);
  }
}
[0].forEach(() => {
  const made = new (class {
    constructor() {
      return path;
    }
  })();
  attempt("kind", () => typeof made.join);
});
