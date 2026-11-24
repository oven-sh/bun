export function whileAboveHas<T>(name: string, field: "shade" | "origin", read: () => T): T {
  const above: object = Reflect.get({}, name);
  Object.defineProperty(above, field, { value: "off the prototype", configurable: true, enumerable: false });
  try { return read(); } finally { Reflect.deleteProperty(above, field); }
}
