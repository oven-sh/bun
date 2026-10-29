// The arguments of a call go onto the stack. A list of a million does not fit, so the call fails before the function is entered,
// also where the function itself can never throw. The error belongs to the try around the call.
function count() { return arguments.length; }
function countRest(...all) { return all.length; }
function first(a, b) { return a; }
function nothing() {}
class Count { constructor() { this.n = arguments.length; } }
class CountRest { constructor(...all) { this.n = all.length; } }
class Below extends Count { constructor(list) { super(...list); } }
class BelowRest extends CountRest { constructor(list) { super(...list); } }
class Passes extends Count {}
const holder = { count() { return arguments.length; }, nothing() {} };
function forward() { return count.apply(this, arguments); }
function tail(list) { "use strict"; return count(...list); }
function* steps(list) { try { yield count(...list); } catch (error) { yield "caught: " + error.message; } }

const big = new Array(1000000).fill(1);
const forms = {
  "arguments": () => { try { return count(...big); } catch (error) { return "caught: " + error.message; } },
  "rest": () => { try { return countRest(...big); } catch (error) { return "caught: " + error.message; } },
  "two parameters": () => { try { return first(...big); } catch (error) { return "caught: " + error.message; } },
  "an empty function": () => { try { return nothing(...big); } catch (error) { return "caught: " + error.message; } },
  "a method": () => { try { return holder.count(...big); } catch (error) { return "caught: " + error.message; } },
  "an empty method": () => { try { return holder.nothing(...big); } catch (error) { return "caught: " + error.message; } },
  "behind an element": () => { try { return count(0, ...big); } catch (error) { return "caught: " + error.message; } },
  "apply": () => { try { return count.apply(null, big); } catch (error) { return "caught: " + error.message; } },
  "apply, rest": () => { try { return countRest.apply(null, big); } catch (error) { return "caught: " + error.message; } },
  "Reflect.apply": () => { try { return Reflect.apply(count, null, big); } catch (error) { return "caught: " + error.message; } },
  "call": () => { try { return count.call(null, ...big); } catch (error) { return "caught: " + error.message; } },
  "bind": () => { try { return count.bind(null, ...big)(); } catch (error) { return "caught: " + error.message; } },
  "new": () => { try { return new Count(...big).n; } catch (error) { return "caught: " + error.message; } },
  "new, rest": () => { try { return new CountRest(...big).n; } catch (error) { return "caught: " + error.message; } },
  "Reflect.construct": () => { try { return Reflect.construct(Count, big).n; } catch (error) { return "caught: " + error.message; } },
  "super": () => { try { return new Below(big).n; } catch (error) { return "caught: " + error.message; } },
  "super, rest": () => { try { return new BelowRest(big).n; } catch (error) { return "caught: " + error.message; } },
  "a constructor nobody wrote": () => { try { return new Passes(...big).n; } catch (error) { return "caught: " + error.message; } },
  "a forwarder": () => { try { return forward(...big); } catch (error) { return "caught: " + error.message; } },
  "a tail call": () => { try { return tail(big); } catch (error) { return "caught: " + error.message; } },
  "a generator": () => steps(big).next().value,
  "finally": () => { let ran = false; try { try { return count(...big); } finally { ran = true; } } catch (error) { return "finally ran " + ran + ": " + error.message; } },
  "Date.now": () => { try { return typeof Date.now(...big); } catch (error) { return "caught: " + error.message; } },
  "performance.now": () => { try { return typeof performance.now(...big); } catch (error) { return "caught: " + error.message; } },
  "Array.isArray": () => { try { return Array.isArray(...big); } catch (error) { return "caught: " + error.message; } },
  "Object.is": () => { try { return Object.is(...big); } catch (error) { return "caught: " + error.message; } },
  "Math.hypot": () => { try { return Math.hypot(...big) > 0; } catch (error) { return "caught: " + error.message; } },
  "String.fromCharCode": () => { try { return String.fromCharCode(...big).length; } catch (error) { return "caught: " + error.message; } },
  "Array.of": () => { try { return Array.of(...big).length; } catch (error) { return "caught: " + error.message; } },
  "push": () => { const to = []; try { return to.push(...big); } catch (error) { return "caught: " + error.message + " " + to.length; } },
};
for (const name in forms) console.log(name + ":", forms[name]());

async function waits() { try { return count(...big); } catch (error) { return "caught: " + error.message; } }
console.log("an async function:", await waits());
console.log("a short list afterward:", count(...big.slice(0, 5)), countRest(...big.slice(0, 6)));
