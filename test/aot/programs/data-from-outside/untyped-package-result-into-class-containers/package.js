export function madeByAnUntypedPackage(what) {
  switch (what) {
    case "array": return [{ field: "given" }];
    case "map": return new Map([["k", { field: "given" }]]);
    case "set": return new Set([{ field: "given" }]);
    case "promise": return Promise.resolve({ field: "given" });
    case "property": return { inner: { field: "given" } };
    case "record": return { k: { field: "given" } };
    case "tuple": return [{ field: "given" }, 1];
  }
}
export function functionOfAnUntypedPackage(what) {
  return () => madeByAnUntypedPackage(what);
}
