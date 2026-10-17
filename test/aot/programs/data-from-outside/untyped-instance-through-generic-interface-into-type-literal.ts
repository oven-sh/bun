// `Codec<Decoded, Encoded>` is a generic interface, so its instantiations share one layout. The object behind `fromText` is an
// instance of a class whose base class is only known at run time: it has no layout, and it comes out of a function that returns
// `any`. It is then passed, without a cast, where a type literal with two of the interface's members is expected.
interface Codec<Decoded, Encoded> {
  readonly name: string
  readonly decode: (input: Encoded) => Decoded
  readonly encode: (input: Decoded) => Encoded
}
const Base: new () => object = (function () {
  function Plain() {}
  return Plain as any
})()
class TextCodec extends Base {
  readonly name = 'text'
  readonly decode = (input: string) => Number(input) + 1
  readonly encode = (input: number) => String(input)
}
const registry: Record<string, any> = { text: new TextCodec() }
const fromText: Codec<number, string> = registry.text
const made: Codec<boolean, number> = { name: 'made', decode: input => input > 0, encode: input => (input ? 1 : 0) }
function roundTrip<Decoded, Encoded>(sample: Encoded, codec: { readonly decode: (input: Encoded) => Decoded; readonly encode: (input: Decoded) => Encoded }): Encoded {
  return codec.encode(codec.decode(sample))
}
console.log(roundTrip('41', fromText), roundTrip(7, made), roundTrip('x', { decode: text => text.length, encode: size => 'y'.repeat(size) }), fromText.name, made.name)
