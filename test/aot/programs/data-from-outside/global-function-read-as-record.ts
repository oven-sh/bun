// `Buffer` is a function with static methods. It is read from `globalThis` through a cast to a type literal that lists two of
// them, which is how a library asks for a global that may be missing. Elsewhere a generic function allocates objects with a
// member of the same name, so the type literal is not without objects of its own.
const buffer = (globalThis as {
  readonly Buffer?: {
    readonly from: (body: string, encoding: 'utf8') => Uint8Array
    readonly byteLength: (body: string, encoding: 'utf8') => number
  }
}).Buffer
const encodeText: (body: string) => Uint8Array = buffer !== undefined ? body => buffer.from(body, 'utf8') : body => new TextEncoder().encode(body)
const byteLength = (body: string) => (buffer !== undefined ? buffer.byteLength(body, 'utf8') : -1)
function span<From, To>(from: From, to: To): { readonly from: From; readonly to: To } {
  return { from, to }
}
const numbers = span(1, 2)
const words = span('a', 'b')
console.log(encodeText('héllo').length, byteLength('héllo'), numbers.from + numbers.to, words.from + words.to)
