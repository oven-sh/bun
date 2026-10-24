// A member of a built-in prototype is what a read finds only while nothing stands in front of it: an own property, a member of a class below, another prototype.
// Each row puts something in front, a member of a class below, or an own property stored by name through a receiver without a type, under a name that is spelled at run time, and reads the member through a receiver whose type is the built-in class.
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

class Loud extends Array<number> {
    map(): any {
        return "LOUD map";
    }
    indexOf(): number {
        return -77;
    }
}
class LoudMap extends Map<string, number> {
    get(): number {
        return -77;
    }
    get size(): number {
        return -78;
    }
}
class Keeper extends Array<number> {
    join: any = replacement;
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

const loud: number[] = Loud.from([1, 2, 3]);
say("Loud, map:", read0Map(loud));
say("Loud, indexOf:", read0IndexOf(loud));
say("Loud, join:", read0Join(loud));
const loudMap: Map<string, number> = new LoudMap([["a", 1]]);
say("LoudMap, get:", read2Get(loudMap));
say("LoudMap, size:", read2Size(loudMap));
say("LoudMap, has:", read2Has(loudMap));
const keeper: number[] = new Keeper();
say("Keeper, join:", read0Join(keeper));
say("Keeper, map:", read0Map(keeper));
function putJoin(target: any): void {
    target.join = replacement;
}
function putHas(target: any): void {
    target.has = replacement;
}
const named: number[] = [1, 2, 3];
say("by name, array, before:", read0Join(named));
putJoin(named);
say("by name, array, join:", read0Join(named));
say("by name, array, map:", read0Map(named));
const namedMap: Map<string, number> = new Map([["a", 1]]);
putHas(namedMap);
say("by name, Map, has:", read2Has(namedMap));
say("by name, Map, get:", read2Get(namedMap));
say("untouched:", read0Join([1, 2, 3]) + " | " + read2Has(new Map([["a", 1]])));
console.log(lines.join("\n"));
