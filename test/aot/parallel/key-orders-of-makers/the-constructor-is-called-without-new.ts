// The order of an object's keys is the order in which its makers stored them, one maker behind the other. ONE SHAPE: the constructor function called on an object of another kind, and Reflect.construct()
interface Type { flags: number; checker?: object; id: number; symbol?: object; objectFlags: number; members?: object; target?: Type; types?: Type[]; value?: unknown; }
let tracing = false;
function Type(this: Type, checker: object, flags: number) { this.flags = flags; if (tracing) this.checker = checker; }
const checker = { name: "checker" };
const symbol = { name: "symbol" };
let count = 0;
function createType(flags: number): Type { const result: Type = new (Type as any)(checker, flags); count++; result.id = count; return result; }
function createTypeWithSymbol(flags: number, symbol: object): Type { const result = createType(flags); result.symbol = symbol; return result; }
function createObjectType(objectFlags: number, symbol: object): Type { const type = createTypeWithSymbol(1, symbol); type.objectFlags = objectFlags; type.members = undefined; return type; }
function createTypeReference(target: Type): Type { const type = createObjectType(4, target.symbol!); type.target = target; return type; }
function createUnionType(types: Type[]): Type { const type = createType(2); type.types = types; type.objectFlags = 8; return type; }
function createLiteralType(value: unknown, symbol: object): Type { const type = createTypeWithSymbol(3, symbol); type.value = value; return type; }
function makeAll(): Type[] { const plain = createType(0); const withSymbol = createTypeWithSymbol(0, symbol); const object = createObjectType(16, symbol); const reference = createTypeReference(object); const union = createUnionType([plain, object]); const literal = createLiteralType("text", symbol); return [plain, withSymbol, object, reference, union, literal]; }
function tell(deed: () => unknown) { try { console.log(String(deed())); } catch (error) { console.log((error as Error).name); } }
const show = (made: object) => Object.keys(made).join() + " " + JSON.stringify(Object.values(made).map(value => typeof value));
const other: any = { late: 1 };
(Type as any).call(other, checker, 3);
console.log(show(other));
tracing = true;
(Type as any).call(other, checker, 4);
console.log(show(other));
function Below(this: any) { }
Below.prototype = Object.create(Type.prototype);
const constructed: any = Reflect.construct(Type as any, [checker, 5], Below as any);
constructed.id = 1;
console.log(show(constructed), constructed instanceof (Below as any));
tracing = false;
function createBelow(): any { const made = Reflect.construct(Type as any, [checker, 6], Below as any); made.id = 2; made.symbol = symbol; return made; }
console.log(show(createBelow()));
