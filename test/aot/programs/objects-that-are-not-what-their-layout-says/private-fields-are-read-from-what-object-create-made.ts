class Counter { #count = 1; static read(c: Counter): number { return c.#count; } bump(): number { return ++this.#count; } }
const stranger = Object.create(Counter.prototype) as Counter;
console.log(Counter.read(new Counter()));
try { console.log(Counter.read(stranger)); } catch (error) { console.log("threw", (error as Error).name); }
try { console.log(stranger.bump()); } catch (error) { console.log("threw", (error as Error).name); }
