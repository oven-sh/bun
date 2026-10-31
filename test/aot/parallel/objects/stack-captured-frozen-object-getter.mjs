// Error.captureStackTrace refuses an object that is closed: it throws, and the object stays frozen or sealed.
const target = {
  x: 1,
  get stack() {
    return "got";
  },
};
Object.freeze(target);

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
