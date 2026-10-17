// makes an object with new of a plain function whose prototype was assigned and which a cast calls a class, and reads a getter and a value of the prototype
const args = "~snippet/args";
interface Primitive {
  readonly _tag: string;
  readonly value: unknown;
}
type PrimitiveClass = new (value: unknown) => Primitive;
function makeExit(tag: string): (value: unknown) => Primitive {
  const Proto = {
    _tag: tag,
    get value(): unknown {
      return (this as any)[args];
    },
  };
  const ExitPrimitive = function (this: any, value: unknown) {
    this[args] = value;
  } as unknown as PrimitiveClass;
  ExitPrimitive.prototype = Proto;
  return function (value: unknown) {
    return new ExitPrimitive(value);
  };
}
const succeed = makeExit("Success");
const operations = 160;
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const made = succeed(i);
    total += (made.value as number) + made._tag.length;
  }
}

console.log(total);
