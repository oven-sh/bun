// Bindings read in their dead zone, by what they will hold: an object, a function, a class, a text, a list, a Map, a symbol, a bigint (cells), a number, a boolean, undefined, null (no cells), and a mix.
const said: string[] = [];
function tell(what: string, read: () => unknown) {
    try { const got = read(); said.push(what + ": " + (typeof got === "symbol" ? "symbol" : typeof got === "bigint" ? got + "n" : typeof got === "function" ? "function " + got.name : JSON.stringify(got instanceof Map ? [...got] : got))); }
    catch (error) { said.push(what + ": " + (error as Error).name + ": " + (error as Error).message + " | " + (error instanceof ReferenceError)); }
}
function readObject() { return anObject; }
function readField() { return anObject.field; }
function readFunction() { return aFunction; }
function callFunction() { return aFunction(2); }
function readClass() { return AClass; }
function makeInstance() { return new AClass().kind; }
function readText() { return aText; }
function lengthOfText() { return aText.length; }
function readList() { return aList; }
function firstOfList() { return aList[0]; }
function readMap() { return aMap; }
function readSymbol() { return aSymbol; }
function readBigInt() { return aBigInt; }
function readNumber() { return aNumber; }
function readBoolean() { return aBoolean; }
function readUndefined() { return anUndefined; }
function readNull() { return aNull; }
function readMix() { return aMix; }
function readLet() { return aLet; }
function underHandler() { try { return anObject.field; } catch (error) { return "caught inside: " + (error as Error).message; } finally { said.push("finally ran"); } }
function twice() { return [anObject, anObject].length; }
function inLoop() { let n = 0; for (let i = 0; i < 3; i++) n += aList.length; return n; }
async function inAsync() { await null; return anObject.field; }
function* inGenerator() { yield 1; yield anObject.field; }
const all: [string, () => unknown][] = [["object", readObject], ["field", readField], ["function", readFunction], ["call", callFunction], ["class", readClass], ["instance", makeInstance], ["text", readText], ["length", lengthOfText],
    ["list", readList], ["first", firstOfList], ["map", readMap], ["symbol", readSymbol], ["bigint", readBigInt], ["number", readNumber], ["boolean", readBoolean], ["undefined", readUndefined], ["null", readNull], ["mix", readMix],
    ["let", readLet], ["under a handler", underHandler], ["twice", twice], ["in a loop", inLoop], ["generator", () => [...inGenerator()]]];
for (const [what, read] of all) tell("before " + what, read);
const early = inAsync().then(value => "async before: " + value, error => "async before: " + error.name + ": " + error.message);
const anObject = { field: globalThis.process ? 7 : 8 };
const aFunction = (n: number) => n * 2;
class AClass { kind = "instance"; }
const aText = ["te", "xt"].join("");
const aList = [1, 2, 3];
const aMap = new Map([[1, 2]]);
const aSymbol = Symbol("s");
const aBigInt = 10n ** 20n;
const aNumber = said.length;
const aBoolean = said.length > 3;
const anUndefined = undefined;
const aNull = null;
const aMix = said.length > 3 ? { a: 1 } : 5;
let aLet = { b: 2 };
for (const [what, read] of all) tell("after " + what, read);
aLet = { b: 3 };
tell("after a store", readLet);
said.push(await early, await inAsync().then(value => "async after: " + value));
console.log(said.join("\n"));
