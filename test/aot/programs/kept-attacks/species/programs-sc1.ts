// Species, one probe of many. It prints what plain Bun prints.
const log: string[] = [];
class ByMap extends Array<number> { constructor(label: string) { super(); log.push((typeof label !== "string" ? "no string" : "a string") + " " + Object.prototype.toString.call(label)); } static one(): ByMap { const made = new ByMap("mine"); made.push(1); return made; } }
try { const mapped = ByMap.one().map(one => one); log.push("mapped " + (mapped instanceof ByMap) + " " + mapped.length); } catch (error) { log.push("threw " + String(error).slice(0, 150)); }
class ByRead extends Array<number> { constructor(label: string) { super(); log.push((typeof label !== "string" ? "no string" : "a string") + " " + Object.prototype.toString.call(label)); } }
try { new (Reflect.get(new ByRead("mine"), "constructor") as any)(1); } catch (error) { log.push("threw " + String(error).slice(0, 150)); }
console.log(log.join("; "));
