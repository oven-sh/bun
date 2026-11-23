export function describeImport(promise) {
  return promise.then(
    found => {
      let extra;
      try {
        extra = found.extra ?? "none";
      } catch {
        extra = "throws";
      }
      return found.name + "/" + extra;
    },
    error => "rejected with " + error.constructor.name,
  );
}
