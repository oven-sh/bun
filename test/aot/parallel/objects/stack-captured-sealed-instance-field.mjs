// Error.captureStackTrace defines "stack" on an object that is closed, so the object is no longer frozen or sealed.
class Holder {
  stack = "own";
  x = 1;
}
const target = new Holder();
Object.seal(target);

const describe = () => {
  const found = Object.getOwnPropertyDescriptor(target, "stack");
  const attributes = found ? ["value" in found ? "value" : "accessor", found.writable, found.configurable, found.enumerable].join("/") : "none";
  return [Object.isFrozen(target), Object.isSealed(target), Object.isExtensible(target), attributes, Reflect.ownKeys(target).join(",")].join(" ");
};
const attempt = (name, action) => {
  try {
    console.log(name, action());
  } catch (error) {
    console.log(name, "threw", error.name, error.message);
  }
  console.log("  ", describe());
};
console.log("closed:", describe());
attempt("capture", () => Error.captureStackTrace(target));
attempt("another property", () => {
  const key = Reflect.ownKeys(target).find(key => key !== "stack");
  const found = Object.getOwnPropertyDescriptor(target, key);
  return [key, found.writable, found.configurable].join("/");
});
attempt("store", () => {
  target.stack = "stored";
  return target.stack;
});
attempt("define", () => Reflect.defineProperty(target, "stack", { value: "defined", enumerable: true }));
attempt("delete", () => Reflect.deleteProperty(target, "stack"));
attempt("store what is gone", () => Reflect.set(target, "stack", "added"));
attempt("capture again", () => Error.captureStackTrace(target));
attempt("freeze again", () => Object.isFrozen(Object.freeze(target)));
