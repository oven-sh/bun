// Alone: another program of the executable that writes these statics in sight of the build unlocks them for this one
// An instance of a class of the host goes where the build loses it and comes back as a value nobody knows. Its `constructor` is the class, whose
// statics the program then writes. The class goes out of sight with its instance, so the write is no write to a locked object.
const hide = value => new CustomEvent("x", { detail: value }).detail;
const mine = () => "mine";
const attempt = (label, write, read) => {
  let how = "stored";
  try {
    write();
  } catch (error) {
    how = `${error.constructor.name}: ${error.message.split(" because ")[0]}`;
  }
  console.log(`${label}: ${how} | ${read()}`);
};

attempt("an instance that a function of Bun made", () => (hide(Bun.pathToFileURL("/a")).constructor.canParse = mine), () => URL.canParse("x:y"));
attempt("an instance that the program made", () => (hide(new URL("x:y")).constructor.parse = mine), () => URL.parse("x:y"));
attempt("the prototype object", () => (hide(URL.prototype).constructor.createObjectURL = mine), () => URL.createObjectURL(new Blob([])));
attempt("the prototype object of the instance", () => (Object.getPrototypeOf(hide(new URL("x:y"))).constructor.revokeObjectURL = mine), () => URL.revokeObjectURL("x"));
attempt("a response", () => (hide(new Response("a")).constructor.json = mine), () => Response.json(1));
attempt("a response that a static made", () => (hide(Response.redirect("x:y")).constructor.error = mine), () => Response.error());
attempt("under a computed key", () => (hide(new Headers())[process.argv.length > 99 ? "x" : "constructor"].extra = mine), () => Headers.extra());
