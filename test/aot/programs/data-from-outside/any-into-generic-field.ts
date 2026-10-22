// A generic class or interface is filled from untyped data: `this.items = data` with `items: T[]`. What T is bound to admits plain data that has all its members. What is bound to the type parameter of a generic class that only typed values enter stays as it is.
// IR+ ^layout (L\d+) .*name="InARepository" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
// IR+ ^layout (L\d+) .*name="InAPage" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
// IR+ ^layout (L\d+) .*name="InAMapOfARepository" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
// IR- ^layout (L\d+) .*name="OnlyTypedValuesEnter" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
function obj(entries: any[]): any { const o: any = {}; for (const entry of entries) o[entry[0]] = entry[1]; return o; }
function data(): any { return [obj([["id", 1], ["name", "given"]]), obj([["name", "second"], ["id", 2]])]; }

class InARepository { id: number = 0; name: string = "made"; }
class Repository<T> { items: T[] = []; fill(from: any) { this.items = from; } first(): T { return this.items[0]; } }
const repository = new Repository<InARepository>();
repository.fill(data());
console.log("a repository:", repository.items[0].name, repository.first().id, repository.items[1] instanceof InARepository, new InARepository().name);

class InAPage { id: number = 0; name: string = "made"; }
interface Page<T> { items: T[]; next?: Page<T> }
function page<T>(from: any): Page<T> { const made: Page<T> = { items: [] }; made.items = from; return made; }
console.log("a page:", page<InAPage>(data()).items[1].name, new InAPage().name);

class InAMapOfARepository { id: number = 0; name: string = "made"; }
class Keyed<T> { byName: Map<string, T> = new Map(); fill(from: any) { this.byName = from; } }
const keyed = new Keyed<InAMapOfARepository>();
keyed.fill(new Map([["k", data()[0]]]));
console.log("a Map:", keyed.byName.get("k")!.name, new InAMapOfARepository().name);

class OnlyTypedValuesEnter { size: number = 3; label: string = "made"; }
class Shelf<T> { items: T[] = []; fill(from: T[]) { this.items = from; } }
const shelf = new Shelf<OnlyTypedValuesEnter>();
shelf.fill([new OnlyTypedValuesEnter()]);
console.log("a generic class that only typed values enter:", shelf.items[0].label, shelf.items[0].size);
