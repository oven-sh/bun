// Which class statements of a TypeScript file `bun run` evaluates before the file's other statements: types, casts and members without code do not count.
function attempt(read: () => unknown): string {
  try {
    return typeof read();
  } catch (error) {
    return (error as Error).name;
  }
}
function effect(): number {
  return 1;
}
function decorate(value: unknown, context: DecoratorContext): void {}
interface Shape { area(): number }
const key = "k";
const readers: Record<string, () => unknown> = {
  Typed: () => Typed,
  Generic: () => Generic,
  Implements: () => Implements,
  Abstract: () => Abstract,
  ParameterProperties: () => ParameterProperties,
  Overloads: () => Overloads,
  IndexSignature: () => IndexSignature,
  DeclaredField: () => DeclaredField,
  DeclaredBracketedField: () => DeclaredBracketedField,
  StaticCast: () => StaticCast,
  StaticAngleCast: () => StaticAngleCast,
  StaticNonNull: () => StaticNonNull,
  StaticSatisfies: () => StaticSatisfies,
  StaticAsConst: () => StaticAsConst,
  StaticCastOfCall: () => StaticCastOfCall,
  StaticReadonly: () => StaticReadonly,
  StaticEnumMember: () => StaticEnumMember,
  StaticConstEnumMember: () => StaticConstEnumMember,
  MergedWithNamespace: () => MergedWithNamespace,
  MergedWithInterface: () => MergedWithInterface,
  DecoratedClass: () => DecoratedClass,
  DecoratedMethod: () => DecoratedMethod,
  DecoratedField: () => DecoratedField,
  AutoAccessor: () => AutoAccessor,
  StaticAutoAccessor: () => StaticAutoAccessor,
  StaticAutoAccessorWithCall: () => StaticAutoAccessorWithCall,
};
for (const name in readers) console.log("early", name, attempt(readers[name]));

enum Color { Red = 1 }
const enum Flag { On = 1 }
class Typed { a: number = 1; b?: string; c!: boolean; m(x: number): number { return x; } static s: number; }
class Generic<T> { value?: T; static make<U>(): Generic<U> { return new Generic<U>(); } }
class Implements implements Shape { area(): number { return 1; } }
abstract class Abstract { abstract m(): void; abstract f: number; n(): number { return 1; } }
class ParameterProperties { constructor(public a: number, private readonly b: string = "b") {} }
class Overloads { m(a: number): void; m(a: string): void; m(a: unknown): void {} }
class IndexSignature { [name: string]: unknown; static [name: string]: unknown; }
class DeclaredField { declare d: number; declare static s: number; }
class DeclaredBracketedField { declare [key]: number; }
class StaticCast { static n = 1 as number; }
class StaticAngleCast { static n = <number>1; }
class StaticNonNull { static n = 1!; }
class StaticSatisfies { static n = 1 satisfies number; }
class StaticAsConst { static n = "n" as const; }
class StaticCastOfCall { static n = effect() as number; }
class StaticReadonly { static readonly n = 1; private static p = "p"; protected static q = null; }
class StaticEnumMember { static c = Color.Red; }
class StaticConstEnumMember { static f = Flag.On; }
class MergedWithNamespace {}
namespace MergedWithNamespace { export const n = effect(); }
class MergedWithInterface {}
interface MergedWithInterface { extra: number }
@decorate class DecoratedClass {}
class DecoratedMethod { @decorate m(): void {} }
class DecoratedField { @decorate f = 1; }
class AutoAccessor { accessor a = effect(); }
class StaticAutoAccessor { static accessor a = 1; }
class StaticAutoAccessorWithCall { static accessor a = effect(); }

for (const name in readers) console.log("late", name, attempt(readers[name]));
console.log(MergedWithNamespace.n, new ParameterProperties(2).a, Generic.make<number>() instanceof Generic);

namespace Inner {
  export const early = attempt(() => InNamespace);
  class InNamespace {}
}
console.log("in a namespace", Inner.early);
