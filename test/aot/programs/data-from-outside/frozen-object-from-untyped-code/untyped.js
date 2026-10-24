export function call(f, config, way) {
  const props = way === "null prototype" ? Object.create(null) : {};
  for (const key in config) {
    if (way === "getter") Object.defineProperty(props, key, { get: () => config[key], enumerable: true, configurable: true });
    else if (way === "not writable") Object.defineProperty(props, key, { value: config[key], enumerable: true, configurable: true, writable: false });
    else props[key] = config[key];
  }
  if (way === "one member more") props.more = 1;
  if (way === "freeze" || way === "seal" || way === "preventExtensions") Object[way](props);
  return f(props);
}
