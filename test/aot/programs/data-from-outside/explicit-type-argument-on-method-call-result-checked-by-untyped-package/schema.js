export function object(shape) {
  return {
    parse(given) {
      const out = {}
      for (const key of Object.keys(shape)) if (key in given) out[key] = given[key]
      return out
    },
  }
}
export function any() {
  return { parse: given => given }
}
