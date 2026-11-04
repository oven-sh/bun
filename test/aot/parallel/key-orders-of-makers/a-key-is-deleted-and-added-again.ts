// The order of an object's keys is the order in which its makers stored them, one maker behind the other. ONE SHAPE: a delete and a store again, outside the makers and inside one
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
const object = createObjectType(1, symbol);
delete object.symbol;
console.log(show(object));
object.symbol = symbol;
console.log(show(object));
console.log(show(createTypeReference(object)));
function createWithoutMembers(): Type { const type = createObjectType(2, symbol); delete type.members; type.target = type; type.members = {}; return type; }
console.log(Object.keys(createWithoutMembers()).join());
function createReferenceBehindIt(): Type { const type = createWithoutMembers(); type.value = 1; return type; }
console.log(Object.keys(createReferenceBehindIt()).join());
