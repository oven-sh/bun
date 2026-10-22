// Further ways by which plain data that has all the members of a class comes to be held to it: a spread argument, a static field, the default of a parameter, a typed function that untyped code calls, a type guard handed on as a value, a union with a built-in class. Each row has a class of its own, so that what enters in one row shows in the types of that class alone. `x as unknown as T` yields the value of x: where x is typed, nothing untyped enters.
// IR+ ^layout (L\d+) .*name="PushedBySpread" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
// IR+ ^layout (L\d+) .*name="Spliced" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
// IR+ ^layout (L\d+) .*name="InAStaticField" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
// IR+ ^layout (L\d+) .*name="ByADefault" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
// IR+ ^layout (L\d+) .*name="GivenToAnArrow" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
// IR+ ^layout (L\d+) .*name="GivenToAFunctionExpression" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
// IR+ ^layout (L\d+) .*name="GivenToADeclaredFunction" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
// IR+ ^layout (L\d+) .*name="GivenToAReducer" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
// IR+ ^layout (L\d+) .*name="FilteredByAGuard" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
// IR+ ^layout (L\d+) .*name="FoundByAGuard" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
// IR+ ^layout (L\d+) .*name="InAUnionWithAnError" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
// IR- ^layout (L\d+) .*name="CastFromATypedValue" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
function obj(entries: any[]): any { const o: any = {}; for (const entry of entries) o[entry[0]] = entry[1]; return o; }
function data(): any { return [obj([["id", 1], ["name", "given"]]), obj([["name", "second"], ["id", 2]])]; }

class PushedBySpread { id: number = 0; name: string = "made"; }
function readPushedBySpread(u: PushedBySpread): string { return u.name + u.id; }
function usePushedBySpread(u: PushedBySpread) { console.log("PushedBySpread:", readPushedBySpread(u), u instanceof PushedBySpread, readPushedBySpread(new PushedBySpread())); }
{
const users: PushedBySpread[] = [new PushedBySpread()];
users.push(...data());
usePushedBySpread(users[1]);
usePushedBySpread(users[0]);
}

class Spliced { id: number = 0; name: string = "made"; }
function readSpliced(u: Spliced): string { return u.name + u.id; }
function useSpliced(u: Spliced) { console.log("Spliced:", readSpliced(u), u instanceof Spliced, readSpliced(new Spliced())); }
{
const users: Spliced[] = [new Spliced()];
users.splice(0, 0, ...data());
useSpliced(users[0]);
}

class InAStaticField { id: number = 0; name: string = "made"; }
function readInAStaticField(u: InAStaticField): string { return u.name + u.id; }
function useInAStaticField(u: InAStaticField) { console.log("InAStaticField:", readInAStaticField(u), u instanceof InAStaticField, readInAStaticField(new InAStaticField())); }
{
class HolderOfInAStaticField { static users: InAStaticField[] = data(); }
useInAStaticField(HolderOfInAStaticField.users[0]);
}

class ByADefault { id: number = 0; name: string = "made"; }
function readByADefault(u: ByADefault): string { return u.name + u.id; }
function useByADefault(u: ByADefault) { console.log("ByADefault:", readByADefault(u), u instanceof ByADefault, readByADefault(new ByADefault())); }
{
function takeByADefault(users: ByADefault[] = data()) { useByADefault(users[0]); }
takeByADefault();
}

class GivenToAnArrow { id: number = 0; name: string = "made"; }
function readGivenToAnArrow(u: GivenToAnArrow): string { return u.name + u.id; }
function useGivenToAnArrow(u: GivenToAnArrow) { console.log("GivenToAnArrow:", readGivenToAnArrow(u), u instanceof GivenToAnArrow, readGivenToAnArrow(new GivenToAnArrow())); }
{
data().map((u: GivenToAnArrow) => useGivenToAnArrow(u));
}

class GivenToAFunctionExpression { id: number = 0; name: string = "made"; }
function readGivenToAFunctionExpression(u: GivenToAFunctionExpression): string { return u.name + u.id; }
function useGivenToAFunctionExpression(u: GivenToAFunctionExpression) { console.log("GivenToAFunctionExpression:", readGivenToAFunctionExpression(u), u instanceof GivenToAFunctionExpression, readGivenToAFunctionExpression(new GivenToAFunctionExpression())); }
{
data().forEach(function (u: GivenToAFunctionExpression) { useGivenToAFunctionExpression(u); });
}

class GivenToADeclaredFunction { id: number = 0; name: string = "made"; }
function readGivenToADeclaredFunction(u: GivenToADeclaredFunction): string { return u.name + u.id; }
function useGivenToADeclaredFunction(u: GivenToADeclaredFunction) { console.log("GivenToADeclaredFunction:", readGivenToADeclaredFunction(u), u instanceof GivenToADeclaredFunction, readGivenToADeclaredFunction(new GivenToADeclaredFunction())); }
{
function eachGivenToADeclaredFunction(u: GivenToADeclaredFunction) { useGivenToADeclaredFunction(u); }
data().forEach(eachGivenToADeclaredFunction);
}

class GivenToAReducer { id: number = 0; name: string = "made"; }
function readGivenToAReducer(u: GivenToAReducer): string { return u.name + u.id; }
function useGivenToAReducer(u: GivenToAReducer) { console.log("GivenToAReducer:", readGivenToAReducer(u), u instanceof GivenToAReducer, readGivenToAReducer(new GivenToAReducer())); }
{
const names: string = data().reduce((all: string, u: GivenToAReducer) => all + readGivenToAReducer(u), "");
console.log(names);
}

class FilteredByAGuard { id: number = 0; name: string = "made"; }
function readFilteredByAGuard(u: FilteredByAGuard): string { return u.name + u.id; }
function useFilteredByAGuard(u: FilteredByAGuard) { console.log("FilteredByAGuard:", readFilteredByAGuard(u), u instanceof FilteredByAGuard, readFilteredByAGuard(new FilteredByAGuard())); }
{
const mixed: unknown[] = data();
const users = mixed.filter((x): x is FilteredByAGuard => typeof x === "object");
useFilteredByAGuard(users[0]);
}

class FoundByAGuard { id: number = 0; name: string = "made"; }
function readFoundByAGuard(u: FoundByAGuard): string { return u.name + u.id; }
function useFoundByAGuard(u: FoundByAGuard) { console.log("FoundByAGuard:", readFoundByAGuard(u), u instanceof FoundByAGuard, readFoundByAGuard(new FoundByAGuard())); }
{
const mixed: unknown[] = data();
const found = mixed.find((x): x is FoundByAGuard => typeof x === "object");
useFoundByAGuard(found!);
}

class InAUnionWithAnError { id: number = 0; name: string = "made"; }
function readInAUnionWithAnError(u: InAUnionWithAnError): string { return u.name + u.id; }
function useInAUnionWithAnError(u: InAUnionWithAnError) { console.log("InAUnionWithAnError:", readInAUnionWithAnError(u), u instanceof InAUnionWithAnError, readInAUnionWithAnError(new InAUnionWithAnError())); }
{
const r: InAUnionWithAnError | Error = data()[0];
if (!(r instanceof Error)) useInAUnionWithAnError(r);
}

class CastFromATypedValue { id: number = 0; name: string = "made"; }
interface Like { id: number; name: string }
const like: Like = new CastFromATypedValue();
console.log("CastFromATypedValue:", (like as unknown as CastFromATypedValue).name);
