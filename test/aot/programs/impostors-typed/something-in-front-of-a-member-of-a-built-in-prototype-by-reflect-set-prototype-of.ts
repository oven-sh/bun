// A member of a built-in prototype is what a read finds only while nothing stands in front of it: an own property, a member of a class below, another prototype.
// Each row puts something in front, by Reflect.setPrototypeOf, under a name that is spelled at run time, and reads the member through a receiver whose type is the built-in class.
// Every call is a call by name and every receiver is made where it is used: a compiler that follows values knows the class of each receiver, and nothing else about it.
// One way a file: what is known of one way must not hide what is not known of another.
const lines: string[] = [];
function say(title: string, answer: string): void {
    lines.push(title + " " + answer);
}
function spell(first: string, second: string): string {
    return [first, second].join("");
}
function replacement(): string {
    return "REPLACED";
}
function double(x: number): number {
    return x * 2;
}
function zero(): number {
    return 0;
}
function nameOfError(error: unknown): string {
    return "throws " + (error as Error).constructor.name;
}
class Quiet extends Array<number> {}
class QuietMap extends Map<string, number> {}

// The object that comes to stand above is a record of the program, filled by name through a receiver with a type: nothing here stores by key, and no built-in is asked.
interface Above {
    map?: unknown; indexOf?: unknown; join?: unknown; push?: unknown; get?: unknown; has?: unknown; size?: unknown; slice?: unknown; charAt?: unknown; test?: unknown; source?: unknown;
    getTime?: unknown; call?: unknown; bind?: unknown; then?: unknown;
}
function makeAbove(key: string, value: unknown): Above {
    const above: Above = {};
    switch (key) {
    case "map": above.map = value; break;
    case "indexOf": above.indexOf = value; break;
    case "join": above.join = value; break;
    case "push": above.push = value; break;
    case "get": above.get = value; break;
    case "has": above.has = value; break;
    case "size": above.size = value; break;
    case "slice": above.slice = value; break;
    case "charAt": above.charAt = value; break;
    case "test": above.test = value; break;
    case "source": above.source = value; break;
    case "getTime": above.getTime = value; break;
    case "call": above.call = value; break;
    case "bind": above.bind = value; break;
    case "then": above.then = value; break;
    }
    return above;
}

function put(target: any, key: string, value: unknown): void {
    Reflect.setPrototypeOf(target, makeAbove(key, value));
}

function read0Map(it: number[]): string {
    try {
        return String(it.map(double));
    } catch (error) {
        return nameOfError(error);
    }
}
function read0IndexOf(it: number[]): string {
    try {
        return String(it.indexOf(2));
    } catch (error) {
        return nameOfError(error);
    }
}
function read0Join(it: number[]): string {
    try {
        return String(it.join("-"));
    } catch (error) {
        return nameOfError(error);
    }
}
function read0Push(it: number[]): string {
    try {
        return String(it.push(4));
    } catch (error) {
        return nameOfError(error);
    }
}
function read1Map(it: Quiet): string {
    try {
        return String(it.map(double));
    } catch (error) {
        return nameOfError(error);
    }
}
function read1Join(it: Quiet): string {
    try {
        return String(it.join("-"));
    } catch (error) {
        return nameOfError(error);
    }
}
function read2Get(it: Map<string, number>): string {
    try {
        return String(it.get("a"));
    } catch (error) {
        return nameOfError(error);
    }
}
function read2Has(it: Map<string, number>): string {
    try {
        return String(it.has("a"));
    } catch (error) {
        return nameOfError(error);
    }
}
function read2Size(it: Map<string, number>): string {
    try {
        return String(it.size);
    } catch (error) {
        return nameOfError(error);
    }
}
function read3Get(it: QuietMap): string {
    try {
        return String(it.get("a"));
    } catch (error) {
        return nameOfError(error);
    }
}
function read3Size(it: QuietMap): string {
    try {
        return String(it.size);
    } catch (error) {
        return nameOfError(error);
    }
}
function read4Has(it: Set<number>): string {
    try {
        return String(it.has(1));
    } catch (error) {
        return nameOfError(error);
    }
}
function read4Size(it: Set<number>): string {
    try {
        return String(it.size);
    } catch (error) {
        return nameOfError(error);
    }
}
function read5Slice(it: String): string {
    try {
        return String(it.slice(1));
    } catch (error) {
        return nameOfError(error);
    }
}
function read5CharAt(it: String): string {
    try {
        return String(it.charAt(0));
    } catch (error) {
        return nameOfError(error);
    }
}
function read6Test(it: RegExp): string {
    try {
        return String(it.test("abc"));
    } catch (error) {
        return nameOfError(error);
    }
}
function read6Source(it: RegExp): string {
    try {
        return String(it.source);
    } catch (error) {
        return nameOfError(error);
    }
}
function read7GetTime(it: Date): string {
    try {
        return String(it.getTime());
    } catch (error) {
        return nameOfError(error);
    }
}
function read8IndexOf(it: Uint8Array): string {
    try {
        return String(it.indexOf(2));
    } catch (error) {
        return nameOfError(error);
    }
}
function read8Join(it: Uint8Array): string {
    try {
        return String(it.join("-"));
    } catch (error) {
        return nameOfError(error);
    }
}
function read9Call(it: (x: number) => number): string {
    try {
        return String(it.call(null, 1));
    } catch (error) {
        return nameOfError(error);
    }
}
function read9Bind(it: (x: number) => number): string {
    try {
        return String(typeof it.bind(null));
    } catch (error) {
        return nameOfError(error);
    }
}
function read10Then(it: Promise<number>): string {
    try {
        return String(typeof it.then(zero));
    } catch (error) {
        return nameOfError(error);
    }
}

say("array, untouched, map:", read0Map([1, 2, 3]));
{
    const made: number[] = [1, 2, 3];
    let outcome = "done";
    try {
        put(made, spell("m", "ap"), replacement);
    } catch (error) {
        outcome = nameOfError(error);
    }
    say("array, map: " + outcome + ":", read0Map(made));
}
say("array, untouched again, map:", read0Map([1, 2, 3]));
say("array, untouched, indexOf:", read0IndexOf([1, 2, 3]));
{
    const made: number[] = [1, 2, 3];
    let outcome = "done";
    try {
        put(made, spell("index", "Of"), replacement);
    } catch (error) {
        outcome = nameOfError(error);
    }
    say("array, indexOf: " + outcome + ":", read0IndexOf(made));
}
say("array, untouched again, indexOf:", read0IndexOf([1, 2, 3]));
say("array, untouched, join:", read0Join([1, 2, 3]));
{
    const made: number[] = [1, 2, 3];
    let outcome = "done";
    try {
        put(made, spell("jo", "in"), replacement);
    } catch (error) {
        outcome = nameOfError(error);
    }
    say("array, join: " + outcome + ":", read0Join(made));
}
say("array, untouched again, join:", read0Join([1, 2, 3]));
say("array, untouched, push:", read0Push([1, 2, 3]));
{
    const made: number[] = [1, 2, 3];
    let outcome = "done";
    try {
        put(made, spell("pu", "sh"), replacement);
    } catch (error) {
        outcome = nameOfError(error);
    }
    say("array, push: " + outcome + ":", read0Push(made));
}
say("array, untouched again, push:", read0Push([1, 2, 3]));
say("instance of a class below Array, untouched, map:", read1Map(Quiet.from([1, 2, 3]) as Quiet));
{
    const made: Quiet = Quiet.from([1, 2, 3]) as Quiet;
    let outcome = "done";
    try {
        put(made, spell("m", "ap"), replacement);
    } catch (error) {
        outcome = nameOfError(error);
    }
    say("instance of a class below Array, map: " + outcome + ":", read1Map(made));
}
say("instance of a class below Array, untouched again, map:", read1Map(Quiet.from([1, 2, 3]) as Quiet));
say("instance of a class below Array, untouched, join:", read1Join(Quiet.from([1, 2, 3]) as Quiet));
{
    const made: Quiet = Quiet.from([1, 2, 3]) as Quiet;
    let outcome = "done";
    try {
        put(made, spell("jo", "in"), replacement);
    } catch (error) {
        outcome = nameOfError(error);
    }
    say("instance of a class below Array, join: " + outcome + ":", read1Join(made));
}
say("instance of a class below Array, untouched again, join:", read1Join(Quiet.from([1, 2, 3]) as Quiet));
say("Map, untouched, get:", read2Get(new Map([["a", 1]])));
{
    const made: Map<string, number> = new Map([["a", 1]]);
    let outcome = "done";
    try {
        put(made, spell("g", "et"), replacement);
    } catch (error) {
        outcome = nameOfError(error);
    }
    say("Map, get: " + outcome + ":", read2Get(made));
}
say("Map, untouched again, get:", read2Get(new Map([["a", 1]])));
say("Map, untouched, has:", read2Has(new Map([["a", 1]])));
{
    const made: Map<string, number> = new Map([["a", 1]]);
    let outcome = "done";
    try {
        put(made, spell("h", "as"), replacement);
    } catch (error) {
        outcome = nameOfError(error);
    }
    say("Map, has: " + outcome + ":", read2Has(made));
}
say("Map, untouched again, has:", read2Has(new Map([["a", 1]])));
say("Map, untouched, size:", read2Size(new Map([["a", 1]])));
{
    const made: Map<string, number> = new Map([["a", 1]]);
    let outcome = "done";
    try {
        put(made, spell("si", "ze"), "REPLACED");
    } catch (error) {
        outcome = nameOfError(error);
    }
    say("Map, size: " + outcome + ":", read2Size(made));
}
say("Map, untouched again, size:", read2Size(new Map([["a", 1]])));
say("instance of a class below Map, untouched, get:", read3Get(new QuietMap([["a", 1]])));
{
    const made: QuietMap = new QuietMap([["a", 1]]);
    let outcome = "done";
    try {
        put(made, spell("g", "et"), replacement);
    } catch (error) {
        outcome = nameOfError(error);
    }
    say("instance of a class below Map, get: " + outcome + ":", read3Get(made));
}
say("instance of a class below Map, untouched again, get:", read3Get(new QuietMap([["a", 1]])));
say("instance of a class below Map, untouched, size:", read3Size(new QuietMap([["a", 1]])));
{
    const made: QuietMap = new QuietMap([["a", 1]]);
    let outcome = "done";
    try {
        put(made, spell("si", "ze"), "REPLACED");
    } catch (error) {
        outcome = nameOfError(error);
    }
    say("instance of a class below Map, size: " + outcome + ":", read3Size(made));
}
say("instance of a class below Map, untouched again, size:", read3Size(new QuietMap([["a", 1]])));
say("Set, untouched, has:", read4Has(new Set([1])));
{
    const made: Set<number> = new Set([1]);
    let outcome = "done";
    try {
        put(made, spell("h", "as"), replacement);
    } catch (error) {
        outcome = nameOfError(error);
    }
    say("Set, has: " + outcome + ":", read4Has(made));
}
say("Set, untouched again, has:", read4Has(new Set([1])));
say("Set, untouched, size:", read4Size(new Set([1])));
{
    const made: Set<number> = new Set([1]);
    let outcome = "done";
    try {
        put(made, spell("si", "ze"), "REPLACED");
    } catch (error) {
        outcome = nameOfError(error);
    }
    say("Set, size: " + outcome + ":", read4Size(made));
}
say("Set, untouched again, size:", read4Size(new Set([1])));
say("String object, untouched, slice:", read5Slice(new String("abc")));
{
    const made: String = new String("abc");
    let outcome = "done";
    try {
        put(made, spell("sli", "ce"), replacement);
    } catch (error) {
        outcome = nameOfError(error);
    }
    say("String object, slice: " + outcome + ":", read5Slice(made));
}
say("String object, untouched again, slice:", read5Slice(new String("abc")));
say("String object, untouched, charAt:", read5CharAt(new String("abc")));
{
    const made: String = new String("abc");
    let outcome = "done";
    try {
        put(made, spell("char", "At"), replacement);
    } catch (error) {
        outcome = nameOfError(error);
    }
    say("String object, charAt: " + outcome + ":", read5CharAt(made));
}
say("String object, untouched again, charAt:", read5CharAt(new String("abc")));
say("RegExp, untouched, test:", read6Test(/b/));
{
    const made: RegExp = /b/;
    let outcome = "done";
    try {
        put(made, spell("te", "st"), replacement);
    } catch (error) {
        outcome = nameOfError(error);
    }
    say("RegExp, test: " + outcome + ":", read6Test(made));
}
say("RegExp, untouched again, test:", read6Test(/b/));
say("RegExp, untouched, source:", read6Source(/b/));
{
    const made: RegExp = /b/;
    let outcome = "done";
    try {
        put(made, spell("sou", "rce"), "REPLACED");
    } catch (error) {
        outcome = nameOfError(error);
    }
    say("RegExp, source: " + outcome + ":", read6Source(made));
}
say("RegExp, untouched again, source:", read6Source(/b/));
say("Date, untouched, getTime:", read7GetTime(new Date(86400000)));
{
    const made: Date = new Date(86400000);
    let outcome = "done";
    try {
        put(made, spell("get", "Time"), replacement);
    } catch (error) {
        outcome = nameOfError(error);
    }
    say("Date, getTime: " + outcome + ":", read7GetTime(made));
}
say("Date, untouched again, getTime:", read7GetTime(new Date(86400000)));
say("Uint8Array, untouched, indexOf:", read8IndexOf(new Uint8Array([1, 2, 3])));
{
    const made: Uint8Array = new Uint8Array([1, 2, 3]);
    let outcome = "done";
    try {
        put(made, spell("index", "Of"), replacement);
    } catch (error) {
        outcome = nameOfError(error);
    }
    say("Uint8Array, indexOf: " + outcome + ":", read8IndexOf(made));
}
say("Uint8Array, untouched again, indexOf:", read8IndexOf(new Uint8Array([1, 2, 3])));
say("Uint8Array, untouched, join:", read8Join(new Uint8Array([1, 2, 3])));
{
    const made: Uint8Array = new Uint8Array([1, 2, 3]);
    let outcome = "done";
    try {
        put(made, spell("jo", "in"), replacement);
    } catch (error) {
        outcome = nameOfError(error);
    }
    say("Uint8Array, join: " + outcome + ":", read8Join(made));
}
say("Uint8Array, untouched again, join:", read8Join(new Uint8Array([1, 2, 3])));
say("function, untouched, call:", read9Call(function (x: number): number { return x + 10; }));
{
    const made: (x: number) => number = function (x: number): number { return x + 10; };
    let outcome = "done";
    try {
        put(made, spell("ca", "ll"), replacement);
    } catch (error) {
        outcome = nameOfError(error);
    }
    say("function, call: " + outcome + ":", read9Call(made));
}
say("function, untouched again, call:", read9Call(function (x: number): number { return x + 10; }));
say("function, untouched, bind:", read9Bind(function (x: number): number { return x + 10; }));
{
    const made: (x: number) => number = function (x: number): number { return x + 10; };
    let outcome = "done";
    try {
        put(made, spell("bi", "nd"), replacement);
    } catch (error) {
        outcome = nameOfError(error);
    }
    say("function, bind: " + outcome + ":", read9Bind(made));
}
say("function, untouched again, bind:", read9Bind(function (x: number): number { return x + 10; }));
say("Promise, untouched, then:", read10Then(Promise.resolve(1)));
{
    const made: Promise<number> = Promise.resolve(1);
    let outcome = "done";
    try {
        put(made, spell("th", "en"), replacement);
    } catch (error) {
        outcome = nameOfError(error);
    }
    say("Promise, then: " + outcome + ":", read10Then(made));
}
say("Promise, untouched again, then:", read10Then(Promise.resolve(1)));

// Another object comes to stand above a record.
interface Options {
    extra?: number;
    label?: string;
}
function readOptions(options: Options): string {
    return String(options.extra) + " " + String(options.label);
}
const bare: Options = {};
const labeled: Options = { label: "own" };
say("a record, before:", readOptions(bare) + " | " + readOptions(labeled));
put(bare, "map", 8);
put(labeled, "map", 8);
say("a record, after:", readOptions(bare) + " | " + readOptions(labeled) + " | " + String((bare as { map?: unknown }).map));

console.log(lines.join("\n"));
