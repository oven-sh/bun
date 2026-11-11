const report = e => [e.name, e.code, e.message, e.requireStack && e.requireStack.join()].join(" | ");
export const computed = async name => {
  try {
    return await import(name);
  } catch (e) {
    return report(e);
  }
};
export const literalPackage = async () => {
  try {
    return await import("no-such-package");
  } catch (e) {
    return report(e);
  }
};
export const literalFile = async () => {
  try {
    return await import("./no-such-file.js");
  } catch (e) {
    return report(e);
  }
};
export const resolve = () => {
  try {
    return import.meta.resolve("no-such-package");
  } catch (e) {
    return report(e);
  }
};
