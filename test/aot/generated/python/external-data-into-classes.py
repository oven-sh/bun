#!/usr/bin/env python3
"""doors-by-which-plain-data-comes-to-a-class.py <n>: a value that satisfies its type is never refused.
The n-th of 113 programs, one door each: class User { id: number = 0; name: string = "made" }; `parsed` is any, an array of two objects that untyped code built and that have both members; `holder` and `record` hold them.
The door is a way of ordinary TypeScript by which such an object comes to be held to User: patterns, push and splice, static fields, defaults, callbacks that untyped code calls, type guards, generic helpers and classes, getters and
setters, literals, other classes with the same members .. `names` lists the programs; a name does in place of the number.
As plain Bun, line by line."""
import sys
DOORS = {
 'genericByConstructor': 'function load<T>(ctor: new () => T, data: any): T[] { return data; }\nconst got = load(User, parsed);\nuse(got[0]);',
 'genericClassField': 'class Repo<T> { items: T[] = []; fill(data: any) { this.items = data; } }\nconst r = new Repo<User>();\nr.fill(parsed);\nuse(r.items[0]);',
 'genericCastHelper': 'function as<T>(x: unknown): T { return x as T; }\nuse(as<User[]>(parsed)[0]);',
 'genericCastHelperOne': 'function as<T>(x: unknown): T { return x as T; }\nuse(as<User>(parsed[0]));',
 'instanceType': 'const got = parsed as InstanceType<typeof User>[];\nuse(got[0]);',
 'objectAssignToHolder': 'class Holder { users: User[] = []; one: User = new User(); }\nconst h = Object.assign(new Holder(), holder);\nuse(h.users[0]);\nuse(h.one);',
 'forOfCast': 'for (const u of parsed as User[]) use(u);',
 'arrayPattern': 'const [first, second]: User[] = parsed;\nuse(first);\nuse(second);',
 'objectPattern': 'const { users, one }: { users: User[]; one: User } = holder;\nuse(users[1]);\nuse(one);',
 'assignmentPattern': 'let u: User = new User();\n[u] = parsed;\nuse(u);',
 'parameterPattern': 'function take({ users: [first] }: { users: User[] }) { use(first); }\ntake(holder);',
 'pushSpread': 'const users: User[] = [new User()];\nusers.push(...parsed);\nuse(users[1]);\nuse(users[0]);',
 'pushOne': 'const users: User[] = [new User()];\nusers.push(parsed[0]);\nuse(users[1]);',
 'unshift': 'const users: User[] = [new User()];\nusers.unshift(parsed[0]);\nuse(users[0]);',
 'concat': 'const users: User[] = [new User()].concat(parsed);\nuse(users[1]);',
 'splice': 'const users: User[] = [new User()];\nusers.splice(0, 0, ...parsed);\nuse(users[0]);',
 'storeElement': 'const users: User[] = [new User()];\nusers[0] = parsed[0];\nuse(users[0]);',
 'fill': 'const users: User[] = new Array<User>(2).fill(parsed[0]);\nuse(users[1]);',
 'spreadLiteral': 'const users: User[] = [...parsed, new User()];\nuse(users[0]);\nuse(users[2]);',
 'mapSet': 'const m = new Map<string, User>();\nm.set("k", parsed[0]);\nuse(m.get("k")!);',
 'setAdd': 'const s = new Set<User>();\ns.add(parsed[0]);\nuse([...s][0]);',
 'arrayFrom': 'const users = Array.from<User>(parsed);\nuse(users[0]);',
 'arrayFromMapped': 'const users = Array.from(parsed, (u: any): User => u);\nuse(users[0]);',
 'mapOfEntries': 'const m = new Map<string, User>(Object.entries(record));\nuse(m.get("a")!);',
 'objectValues': 'const typed: Record<string, User> = record;\nuse(Object.values(typed)[0]);',
 'objectEntries': 'const typed: Record<string, User> = record;\nfor (const [, u] of Object.entries(typed)) use(u);',
 'fieldInitializer': 'class Holder { users: User[] = parsed; }\nuse(new Holder().users[0]);',
 'staticField': 'class Holder { static users: User[] = parsed; }\nuse(Holder.users[0]);',
 'defaultParameter': 'function take(users: User[] = parsed) { use(users[0]); }\ntake();',
 'parameterProperty': 'class Holder { constructor(public users: User[]) {} }\nuse(new Holder(parsed).users[0]);',
 'generatorYield': 'function* each(): Generator<User> { yield parsed[0]; yield* parsed; }\nfor (const u of each()) use(u);',
 'asyncGenerator': 'async function* each(): AsyncGenerator<User> { yield parsed[0]; }\nfor await (const u of each()) use(u);',
 'callbackOfUntypedMap': 'parsed.map((u: User) => use(u));',
 'callbackOfUntypedForEach': 'parsed.forEach(function (u: User) { use(u); });',
 'typedCallbackHandedOver': 'function each(u: User) { use(u); }\nparsed.forEach(each);',
 'thenCallback': 'await Promise.resolve(parsed).then((users: User[]) => use(users[0]));',
 'promiseAll': 'const users: User[] = await Promise.all(parsed.map((u: any) => Promise.resolve(u)));\nuse(users[0]);',
 'reviver': 'const users: User[] = JSON.parse(text, (key, value) => value);\nuse(users[0]);',
 'structuredCloneOfOwn': 'const copy = structuredClone(new User());\nuse(copy);',
 'structuredCloneOfOwnArray': 'const copies = structuredClone([new User()]);\nuse(copies[0]);',
 'jsonRoundTripOfOwn': 'const copy: User = JSON.parse(JSON.stringify(new User()));\nuse(copy);',
 'conditional': 'const users: User[] = parsed.length ? parsed : [];\nuse(users[0]);',
 'nullish': 'const users: User[] = parsed ?? [];\nuse(users[0]);',
 'logicalOr': 'const users: User[] = parsed || [];\nuse(users[0]);',
 'satisfies': 'const users = (parsed as User[]) satisfies User[];\nuse(users[0]);',
 'nonNull': 'const users: User[] = parsed!;\nuse(users[0]);',
 'typeGuard': 'function isUsers(x: unknown): x is User[] { return Array.isArray(x); }\nconst x: unknown = parsed;\nif (isUsers(x)) use(x[0]);',
 'typeGuardOne': 'function isUser(x: unknown): x is User { return typeof x === "object" && x !== null && "name" in x; }\nconst x: unknown = parsed[0];\nif (isUser(x)) use(x);',
 'assertsGuard': 'function assertUsers(x: unknown): asserts x is User[] { if (!Array.isArray(x)) throw new Error("no"); }\nconst x: unknown = parsed;\nassertUsers(x);\nuse(x[0]);',
 'filterGuard': 'const mixed: unknown[] = parsed;\nconst users = mixed.filter((x): x is User => typeof x === "object");\nuse(users[0]);',
 'findGuard': 'const mixed: unknown[] = parsed;\nconst found = mixed.find((x): x is User => typeof x === "object");\nuse(found!);',
 'inNarrowing': 'const x: User | string = parsed[0];\nif (typeof x !== "string") use(x);',
 'tupleRest': 'const t: [number, ...User[]] = [1, ...parsed];\nuse(t[1] as User);',
 'readonlyArray': 'const users: ReadonlyArray<User> = parsed;\nuse(users[0]);',
 'partial': 'const p: Partial<User>[] = parsed;\nconsole.log(p[0].name, p[0].id);',
 'pick': 'const p: Pick<User, "name">[] = parsed;\nconsole.log(p[0].name);',
 'required': 'const p: Required<User>[] = parsed;\nconsole.log(p[0].name, p[0].id);',
 'readonlyMapped': 'const p: Readonly<User>[] = parsed;\nconsole.log(p[0].name, p[0].id);',
 'indexedAccess': 'interface Api { users: User[] }\nconst users: Api["users"] = parsed;\nuse(users[0]);',
 'aliasOfArray': 'type Users = User[];\nconst users: Users = parsed;\nuse(users[0]);',
 'interfaceExtendsClass': 'interface Named extends User { extra?: number }\nconst users: Named[] = parsed;\nuse(users[0]);',
 'heirHeldToBase': 'class Admin extends User { level: number = 1; }\nconst admins: Admin[] = JSON.parse(\'[{"id":1,"name":"given","level":2}]\');\nuse(admins[0]);\nconsole.log(admins[0].level, new Admin().level);',
 'classExpression': 'const Local = class { id: number = 0; name: string = "made"; };\nconst locals: InstanceType<typeof Local>[] = parsed;\nconsole.log(locals[0].name, new Local().name);',
 'weakMapValue': 'const key = {};\nconst w = new WeakMap<object, User>();\nw.set(key, parsed[0]);\nuse(w.get(key)!);',
 'closureVariable': 'let kept: User[] = [];\nfunction fill(data: any) { kept = data; }\nfill(parsed);\nuse(kept[0]);',
 'returnOfMethodOfAny': 'const users: User[] = holder.users.slice();\nuse(users[0]);',
 'optionalChain': 'const u: User | undefined = holder?.users?.[0];\nif (u) use(u);',
 'reduce': 'const byName = (parsed as User[]).reduce<Record<string, User>>((all, u) => { all[u.name] = u; return all; }, {});\nuse(byName.given);',
 'groupBy': 'const groups = Object.groupBy(parsed as User[], u => u.name);\nuse(groups.given![0]);',
 'sortCast': 'const users = (parsed as User[]).sort((a, b) => a.id - b.id);\nuse(users[0]);',
 'mapCast': 'const names = (parsed as User[]).map(u => u.name + u.id);\nconsole.log(names.join());',
 'findCast': 'const u = (parsed as User[]).find(u => u.id === 2);\nuse(u!);',
 'flatMapCast': 'const users = ([parsed] as User[][]).flatMap(x => x);\nuse(users[0]);',
 'entriesCast': 'for (const [i, u] of (parsed as User[]).entries()) { console.log(i); use(u); }',
 'literalToClass': 'const u: User = { id: 1, name: "given" };\nuse(u);',
 'literalsInArray': 'const users: User[] = [{ id: 1, name: "given" }, new User()];\nuse(users[0]);\nuse(users[1]);',
 'literalArgument': 'use({ id: 1, name: "given" });',
 'literalReturned': 'function make(): User { return { id: 1, name: "given" }; }\nuse(make());',
 'literalInMap': 'const m = new Map<string, User>([["k", { id: 1, name: "given" }]]);\nuse(m.get("k")!);',
 'literalInField': 'class Holder { one: User = { id: 1, name: "given" }; }\nuse(new Holder().one);',
 'literalPushed': 'const users: User[] = [];\nusers.push({ id: 1, name: "given" });\nuse(users[0]);',
 'literalInProperty': 'const h: { inner: User } = { inner: { id: 1, name: "given" } };\nuse(h.inner);',
 'recordToClass': 'interface Like { id: number; name: string }\nconst like: Like = { id: 1, name: "given" };\nconst u: User = like;\nuse(u);',
 'recordsToClasses': 'interface Like { id: number; name: string }\nconst likes: Like[] = [{ id: 1, name: "given" }];\nconst users: User[] = likes;\nuse(users[0]);',
 'otherClassToClass': 'class Twin { id: number = 1; name: string = "given"; }\nconst u: User = new Twin();\nuse(u);',
 'otherClassesToClasses': 'class Twin { id: number = 1; name: string = "given"; }\nconst users: User[] = [new Twin()];\nuse(users[0]);',
 'staticFactory': 'class Maker { static from(data: any): User { return data; } }\nuse(Maker.from(parsed[0]));',
 'getterOverAny': 'class Holder { raw: any = parsed[0]; get current(): User { return this.raw; } }\nuse(new Holder().current);',
 'getterOverAnyArray': 'class Holder { raw: any = parsed; get all(): User[] { return this.raw; } }\nuse(new Holder().all[0]);',
 'setter': 'class Holder { kept: User = new User(); set current(u: User) { this.kept = u; } }\nconst h = new Holder();\nh.current = parsed[0];\nuse(h.kept);',
 'constructorStore': 'class Holder { users: User[]; constructor(data: any) { this.users = data.users; } }\nuse(new Holder(holder).users[0]);',
 'indexSignatureClass': 'class Book { [key: string]: User; }\nconst b = new Book();\nb.k = parsed[0];\nuse(b.k);',
 'fromEntriesOfAny': 'const byId: Record<string, User> = Object.fromEntries(parsed.map((u: any) => [u.name, u]));\nuse(byId.given);',
 'mapOfAnyPairsCast': 'const m = new Map(parsed.map((u: any) => [u.id, u])) as Map<number, User>;\nuse(m.get(1)!);',
 'castThenDestructure': 'const { users } = holder as { users: User[] };\nuse(users[0]);',
 'forOfPattern': 'for (const { name, id } of parsed as User[]) console.log(name, id);',
 'caught': 'try { throw parsed[0]; } catch (e) { use(e as User); }',
 'caughtAnnotatedLater': 'try { throw parsed[0]; } catch (e) { const u: User = e as any; use(u); }',
 'constrainedGeneric': 'function first<T extends User>(xs: T[]): T { return xs[0]; }\nuse(first(parsed));',
 'constrainedGenericExplicit': 'function first<T extends User>(xs: T[]): T { return xs[0]; }\nuse(first<User>(parsed));',
 'unionWithError': 'const r: User | Error = parsed[0];\nif (!(r instanceof Error)) use(r);',
 'awaitedAll': 'async function load(): Promise<User[]> { return parsed; }\nconst [users] = await Promise.all([load()]);\nuse(users[0]);',
 'thenChain': 'async function load(): Promise<any> { return parsed; }\nconst users: User[] = await load().then(x => x);\nuse(users[0]);',
 'optionalField': 'class Holder { one?: User; }\nconst h = new Holder();\nh.one = parsed[0];\nuse(h.one!);',
 'nestedGeneric': 'interface Page<T> { items: T[]; next?: Page<T> }\nconst page: Page<User> = obj([["items", parsed]]);\nuse(page.items[0]);',
 'genericInterfaceResult': 'interface Api<T> { get(): T }\nconst api: Api<User[]> = { get: () => parsed };\nuse(api.get()[0]);',
 'callbackParameterOfTypedFunction': 'function withUsers(run: (users: User[]) => void, data: any) { run(data); }\nwithUsers(users => use(users[0]), parsed);',
 'eventStyle': 'const handlers: ((u: User) => void)[] = [];\nhandlers.push(u => use(u));\nconst emit: any = (x: any) => handlers.forEach(h => h(x));\nemit(parsed[0]);',
 'boundMethod': 'class Sink { seen: User[] = []; take(u: User) { this.seen.push(u); } }\nconst sink = new Sink();\nparsed.forEach(sink.take.bind(sink));\nuse(sink.seen[0]);',
 'methodAsCallback': 'class Sink { seen: User[] = []; take = (u: User) => { this.seen.push(u); }; }\nconst sink = new Sink();\nparsed.forEach(sink.take);\nuse(sink.seen[0]);',
 'sortComparatorOfAny': 'parsed.sort((a: User, b: User) => a.id - b.id);\nuse(parsed[0]);',
 'reduceOfAny': 'const names: string = parsed.reduce((all: string, u: User) => all + read(u), "");\nconsole.log(names);',
 'promiseThenTypedParameter': 'await Promise.resolve(parsed[0]).then((u: User) => use(u));',
}
names = list(DOORS)
if sys.argv[1] == 'count': print(len(names)); sys.exit()
if sys.argv[1] == 'names': print('\n'.join('door.' + n for n in names)); sys.exit()
n = names[int(sys.argv[1])] if sys.argv[1].isdigit() else sys.argv[1].split('.')[1]
print(f"""// {n}
export {{}};
declare const console: any;
class User {{ id: number = 0; name: string = "made"; }}
function obj(entries: any[]): any {{ const o: any = {{}}; for (const entry of entries) o[entry[0]] = entry[1]; return o; }}
const parsed: any = [obj([["id", 1], ["name", "given"]]), obj([["name", "second"], ["id", 2]])];
const holder: any = obj([["users", parsed], ["one", parsed[1]]]);
const record: any = obj([["a", parsed[0]], ["b", parsed[1]]]);
const text: string = JSON.stringify(parsed);
function read(u: User): string {{ return u.name + u.id; }}
function use(u: User) {{ try {{ console.log(u.id, u.name, read(u), u instanceof User, Object.keys(u).join(), JSON.stringify({{ ...u }}), (u.name = u.name + "!", u.name)); }} catch (error) {{ console.log("THROWS " + String(error).split(" (bun")[0]); }} }}
use(new User());
try {{
{DOORS[n]}
}} catch (error) {{ console.log("THROWS OUTSIDE " + String(error).split(" (bun")[0]); }}
use(new User());""")
