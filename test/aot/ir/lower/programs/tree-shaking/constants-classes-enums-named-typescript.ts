// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// Each declaration has one reference, and it is written in a form that only TypeScript has: `import a = N.b`, `export import`, `export =` in another file, a namespace that closes over it, a parameter property's default, `satisfies`, `as const`, a non-null mark, an angle-bracket cast, an instantiation expression, an enum initializer, an abstract class's heritage, an accessor's initializer. `bun run` does not get as far as running it (SyntaxError: import call expects one or two arguments), so `bun build --compile` is the reference.
import assigned = require("./assigned");

const closedOver = "closed over by a namespace";
namespace Closes { export const value = closedOver; }
const inNested = "closed over two namespaces deep";
namespace Outer { export namespace Inner { export function read() { return inNested; } } }
namespace Holder { export const held = { text: "aliased out of a namespace" }; export enum Kind { A = "an enum aliased out of a namespace" } }
import held = Holder.held;
import Kind = Holder.Kind;
enum Aliased { Member = "an enum under an alias" }
import Alias = Aliased;
const asDefault = "the default of a parameter property";
class WithProperty { constructor(public value = asDefault) {} }
const satisfied = { text: "satisfies" };
const constant = ["as const"];
const nonNull: string | undefined = "non-null";
const angled = "an angle-bracket cast";
const generic = <T,>(value: T) => value;
const length = 5;
enum Computed { Size = length * 2 }
abstract class Abstract { hello() { return "an abstract base"; } }
class Concrete extends Abstract {}
const forAccessor = "the initializer of an accessor";
class WithAccessor { accessor value = forAccessor; }
const forOptional = { deep: { text: "an optional chain" } };
const forDefinite = "a definite assignment";
let definite!: string;
definite = forDefinite;

const instantiated = generic<string>;
console.log(Closes.value, Outer.Inner.read(), held.text, Kind.A, Alias.Member, new WithProperty().value);
console.log((satisfied satisfies object).text, (constant as readonly string[])[0], nonNull!, <string>angled, instantiated("an instantiation expression"), Computed.Size);
console.log(new Concrete().hello(), new WithAccessor().value, forOptional?.deep?.text, definite, assigned.text, assigned.list[0]);

// FILE: assigned.ts
const text = "handed out by export =";
const list = ["with a list"];
const unused = "unused";
const whole = { text, list };
export = whole;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: WithProperty hello WithAccessor value read generic Concrete
// CHECK-LABEL: function {{*}}name="WithProperty"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_2]] flags=[OmitsNull]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything, v2: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetConstructPrototype v1 layout=[[L_3]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_3]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_4]]
// CHECK-NEXT: v7 = TypeTest v2 testedType=undefined
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = GetEnvironmentField v0 layout=[[L_1]] field=1
// CHECK-NEXT: v10 = CheckInitialized v9 name="asDefault"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b5(v11)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: Jump -> next b5(v12)
// CHECK-NEXT: b5(v13):
// CHECK-NEXT: PropSet v5, v13 key="value"
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: v16 = TypeTest v15 testedType=object
// CHECK-NEXT: Branch v16 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v17):
// CHECK-NEXT: Jump -> next b8(v17)
// CHECK-NEXT: b7(v18):
// CHECK-NEXT: Jump -> next b8(v5)
// CHECK-NEXT: b8(v19):
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="hello"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="an abstract base"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="WithAccessor"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] captures=[{type=env [[L_1]] flags=[IsFromCompiler]}, {type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: classtoken, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetConstructPrototype v2 layout=[[L_7]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_7]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v0, v1, v5 function=[[f_8]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="value"
// CHECK: module=[[m_0]] position={{*}} kind=Getter flags=[HasThis, IsChecked] captures=[{type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: classtoken, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PrivateGet v1, v0 layout=[[L_7]] field=1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="value"
// CHECK: module=[[m_0]] position={{*}} kind=Setter flags=[HasThis, IsChecked] length=1 captures=[{type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: classtoken, v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: PrivateSet v1, v0, v3 layout=[[L_7]] field=1
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, IsChecked, HasExplicitName] captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: env [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_1]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="inNested"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="generic"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy, IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_12]] site=[[w_13]]}] results=[{type=undefined|null|[[L_12]] site=[[w_14]]}] functionTypes={{*}}[[f_15]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_12]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_12]] site=[[w_14]]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Concrete"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_16]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_17]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_17]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
