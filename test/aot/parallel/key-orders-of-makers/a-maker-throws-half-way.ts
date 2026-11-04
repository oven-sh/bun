// The order of an object's keys is the order in which its makers stored them, one maker behind the other. ONE SHAPE: a maker that throws between two stores
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
let seen: Type | undefined;
function createThrowing(flags: () => number): Type { const type = createType(0); seen = type; type.symbol = symbol; type.objectFlags = flags(); type.members = undefined; return type; }
function behindThrowing(flags: () => number): Type { const type = createThrowing(flags); type.value = 1; return type; }
tell(() => show(behindThrowing(() => 1)));
tell(() => show(behindThrowing(() => { throw new RangeError("no"); })));
console.log(show(seen!));
seen!.members = {};
seen!.objectFlags = 2;
console.log(show(seen!));
