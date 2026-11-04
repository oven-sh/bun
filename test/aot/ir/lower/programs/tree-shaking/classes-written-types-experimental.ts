// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1

// FILE: main.ts
// experimentalDecorators with emitDecoratorMetadata: the types of decorated members become values. Each of these classes and constants could be left out, were it not for the metadata, a decorator's argument, or a parameter decorator.
declare global { namespace Reflect { function metadata(key: string, value: unknown): (target: any, member?: string | symbol) => void; } }
const recorded = new Map<string, any>();
Reflect.metadata = (key, value) => (target, member) => { recorded.set(key + " " + String(member ?? "class"), value); };
const noted = (...parts: unknown[]): void => {};
const inject = (token: { name: string }) => (target: object, member: string | undefined, index: number) => { recorded.set("token " + index, token); };
const token = { name: "a constant that a parameter decorator names" };

class Engine { start() { return "engine"; } }
class Wheel { turn() { return "wheel"; } }
class Radio { play() { return "radio"; } }
const Horn = class { sound() { return "horn"; } };
type Horn = InstanceType<typeof Horn>;
class NotInMetadata { never() { return "never"; } }
enum Fuel { Petrol, Diesel }

@noted
class Car {
  @noted radio!: Radio;
  @noted fuel!: Fuel;
  @noted horn!: Horn;
  plain!: NotInMetadata;
  constructor(engine: Engine, @inject(token) wheel: Wheel) {}
}

const [engine, wheel] = recorded.get("design:paramtypes class");
console.log(new engine().start(), new wheel().turn(), new (recorded.get("design:type radio"))().play());
console.log(recorded.get("design:type fuel").name, recorded.get("design:type horn").name, recorded.get("token 1").name);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "typeRoots": [ "../../../../../packages" ], "types": [ "bun-types" ], "noEmit": true, "experimentalDecorators": true, "emitDecoratorMetadata": true } }

// GENERATED: start noted inject Car
// CHECK-LABEL: function {{*}}name="start"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="engine"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="noted"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[HasRestParameter, IsChecked] thisType={type=anything} parameters=[{type=Array site=[[w_2]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inject"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[f_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_9]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Car"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_10]] site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[L_12]] site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_10]], v2: undefined|null|[[L_12]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetConstructPrototype v0 layout=[[L_14]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_14]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_14]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_15]]
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b4(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Jump -> next b4(v5)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
