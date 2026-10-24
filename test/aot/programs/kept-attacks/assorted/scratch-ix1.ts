// Assorted, one probe of many. It prints what plain Bun prints.
const log: string[] = [];
class Shelf { set 0(value: string) { log.push("setter " + typeof value); } get 1(): string { log.push("getter"); return "g"; } }
const shelf = new Shelf();
try { shelf[0] = "book"; } catch (error) { log.push("threw " + String(error).slice(0, 90)); }
try { log.push(shelf[1]); } catch (error) { log.push("threw " + String(error).slice(0, 90)); }
try { (shelf as any)[0] = 5; } catch (error) { log.push("threw " + String(error).slice(0, 90)); }
console.log(log.join("; "));
