// `Math` and `JSON` are native objects. They are read from `globalThis` through a type literal that lists one method of each.
const host = globalThis as {
  readonly Math: { readonly max: (a: number, b: number) => number }
  readonly JSON: { readonly stringify: (value: unknown) => string }
}
function box<Max>(max: Max): { readonly max: Max } {
  return { max }
}
function text<Stringify>(stringify: Stringify): { readonly stringify: Stringify } {
  return { stringify }
}
console.log(host.Math.max(1, 2), host.JSON.stringify([1]), box(3).max, text('t').stringify)
