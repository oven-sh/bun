// A closure with its own type parameter is called through the value that another function returns. Its parameter is a type
// literal that mentions the type parameter. The argument is typed by an interface, and the object behind it is an instance of
// a class whose base class is only known at run time, so it has no layout.
interface Pipeable {
  pipe(): string
}
const Base: new () => Pipeable = (function () {
  function PipeableBase() {}
  PipeableBase.prototype = {
    pipe() {
      return 'piped'
    },
  }
  return PipeableBase as any
})()
interface Codec<Decoded, Encoded> extends Pipeable {
  readonly decode: (input: Encoded) => Decoded
  readonly encode: (input: Decoded) => Encoded
}
const Codec: new <Decoded, Encoded>(decode: (input: Encoded) => Decoded, encode: (input: Decoded) => Encoded) => Codec<Decoded, Encoded> = class<Decoded, Encoded> extends Base {
  readonly decode: (input: Encoded) => Decoded
  readonly encode: (input: Decoded) => Encoded
  constructor(decode: (input: Encoded) => Decoded, encode: (input: Decoded) => Encoded) {
    super()
    this.decode = decode
    this.encode = encode
  }
}
function link<Decoded>() {
  return <Encoded,>(sample: Encoded, codec: { readonly decode: (input: Encoded) => Decoded; readonly encode: (input: Decoded) => Encoded }) => codec.encode(codec.decode(sample))
}
const numberFromString: Codec<number, string> = new Codec((text: string) => Number(text) + 1, (value: number) => String(value))
console.log(link<number>()('41', numberFromString))
console.log(link<number>()('four', { decode: text => text.length, encode: value => 'x'.repeat(value) }))
console.log(numberFromString.pipe())
