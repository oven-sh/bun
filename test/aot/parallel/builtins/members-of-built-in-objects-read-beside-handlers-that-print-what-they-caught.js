// A handler at the top level, in a function, in a method, in an initializer of a field, in an async function and on a promise, each of which prints what it caught or a part of it.
// No built-in object goes out of sight, so none of them can be what is printed, and no read of a member has to be seen to happen.
// IR- InitializeBuiltin
function refuse(n) { if (n < 0) throw new RangeError("no " + n); return n; }
function refuseWithRecord(n) { if (n < 0) throw { code: n }; return n; }
function inFunction(n) { try { return refuseWithRecord(n); } catch (thrown) { console.log(thrown); return 0; } }
class Holder {
  field = (() => { try { return refuse(-3); } catch (error) { console.log(String(error)); return 3; } })();
  inMethod(n) { try { return refuse(n); } catch (error) { console.error(error.name, error.message); return this.field; } }
}
async function inAsyncFunction(n) { try { return await Promise.resolve(refuse(n)); } catch (error) { console.log(`${error.message}!`, [error.message]); return 4; } }

const entries = Object.entries({ a: 1, b: 2 }).length, names = Object.keys({ a: 1 }).length;
const longest = Math.hypot(3, 4), root = Math.cbrt(27);
const has = Reflect.has({ a: 1 }, "a"), text = JSON.stringify({ a: 1 });
const whole = Number.isInteger(4), list = Array.of(1, 2).length;
let atTopLevel = 1;
try { null.missing; } catch (error) { console.log(error.message); atTopLevel = 2; }
const results = [atTopLevel, inFunction(-1), new Holder().inMethod(-2)];
Promise.reject(new TypeError("rejected")).catch(reason => { console.log(reason.message); return inAsyncFunction(-4); }).then(last => {
  console.log(entries, names, longest, root, has, text, whole, list, results.join(), last);
});
