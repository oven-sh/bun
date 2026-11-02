const printValue = (() => {
  const { log } = console;
  const { ownKeys, getOwnPropertyDescriptor, getPrototypeOf, apply } = Reflect;
  const { isArray } = Array;
  const { is } = Object;
  const tagOf = Object.prototype.toString;
  const charCodeAt = String.prototype.charCodeAt;
  const numberToString = Number.prototype.toString;
  const symbolDescription = getOwnPropertyDescriptor(Symbol.prototype, "description").get;
  const maxDepth = 3;
  const maxKeys = 12;
  const maxCharacters = 60;

  function quote(text) {
    let quoted = '"';
    for (let i = 0; i < text.length && i < maxCharacters; i++) {
      const code = apply(charCodeAt, text, [i]);
      quoted +=
        code >= 32 && code < 127 && code !== 34 && code !== 92 ? text[i] : "\\u" + apply(numberToString, code, [16]);
    }
    return quoted + (text.length > maxCharacters ? '"+' + (text.length - maxCharacters) : '"');
  }

  function describeKey(key) {
    return typeof key === "symbol" ? "[" + describe(key, maxDepth) + "]" : quote(key);
  }

  function describeProperty(object, key, depth) {
    const descriptor = getOwnPropertyDescriptor(object, key);
    if (!descriptor) return "gone";
    const flags =
      (descriptor.writable ? "w" : "") + (descriptor.enumerable ? "e" : "") + (descriptor.configurable ? "c" : "");
    if ("value" in descriptor) return flags + " " + describe(descriptor.value, depth);
    return (
      flags +
      (descriptor.get ? " get " + attempt(() => describe(object[key], depth)) : "") +
      (descriptor.set ? " set" : "")
    );
  }

  function attempt(describeIt) {
    try {
      return describeIt();
    } catch (error) {
      return "threw " + (typeof error === "object" && error !== null ? apply(tagOf, error, []) : typeof error);
    }
  }

  function describe(value, depth) {
    switch (typeof value) {
      case "undefined":
      case "boolean":
        return "" + value;
      case "number":
        return is(value, -0) ? "-0" : "" + value;
      case "bigint":
        return value + "n";
      case "string":
        return quote(value);
      case "symbol":
        return "Symbol(" + apply(symbolDescription, value, []) + ")";
      case "function":
        return "function " + attempt(() => describe(value.name, maxDepth) + " " + describe(value.length, maxDepth));
    }
    if (value === null) return "null";
    const tag = attempt(() => apply(tagOf, value, []));
    if (depth >= maxDepth) return tag;
    const keys = ownKeys(value);
    if (keys.length > 4 * maxKeys && !isArray(value)) return tag + " with many keys";
    let text = tag + " " + keys.length + " {";
    for (let i = 0; i < keys.length && i < maxKeys; i++)
      text +=
        (i ? ", " : " ") + describeKey(keys[i]) + ": " + attempt(() => describeProperty(value, keys[i], depth + 1));
    const prototype = getPrototypeOf(value);
    return (
      text + " } below " + (prototype === null ? "null" : attempt(() => describe(prototype.constructor, maxDepth)))
    );
  }

  return (name, value) => log(name + " = " + attempt(() => describe(value, 0)));
})();
