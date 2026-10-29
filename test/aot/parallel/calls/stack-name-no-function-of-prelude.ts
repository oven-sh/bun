// Where the compiler puts a function of its own in the place of what the program wrote (a chain of array methods, Array.from({ length }, mapper), new Array(n).fill(v).map(mapper), JSON.stringify of a known shape),
// a stack trace that a callback makes names the program's functions and none of the compiler's. The built-ins' own frames are left out: a chain that is made one loop has none.
const names = (e: any) => String(e.stack).split("\n").slice(1).map((l: string) => l.trim().split(" ")[1].replace(/^.*[\\/]/, "")).filter((n: string) => !/^(map|filter|from|forEach|join|stringify|toJSON)$/.test(n)).join(" < ");
function thrower(): number { throw new Error("x"); }
function chain() { try { return [1, 2].map(thrower).join(","); } catch (e) { return names(e); } }
function chain2() { try { return [1, 2].filter(() => true).map(thrower).length; } catch (e) { return names(e); } }
function from(n: number) { try { return Array.from({ length: n }, thrower); } catch (e) { return names(e); } }
function filled(n: number) { try { return new Array(n).fill(0).map(thrower); } catch (e) { return names(e); } }
function json(o: { a: { toJSON(): number } }) { try { return JSON.stringify(o); } catch (e) { return names(e); } }
console.log(chain()); console.log(chain2()); console.log(from(2)); console.log(filled(2)); console.log(json({ a: { toJSON: thrower } }));
