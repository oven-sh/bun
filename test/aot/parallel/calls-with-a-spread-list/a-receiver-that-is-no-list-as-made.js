// `list.push(a, ...other)`: frozen, sealed, not extensible, a length that is not writable, a class below Array, a push of its own, an object that is like a list.
function on(receiver, source) { try { receiver.push("a", ...source); return JSON.stringify(receiver) + " " + receiver.length; } catch (error) { return "threw " + error.name + " " + JSON.stringify(receiver); } }
function freshThen(deed, source) { const out = ["w"]; deed(out); try { out.push("a", ...source); return JSON.stringify(out) + " " + out.length; } catch (error) { return "threw " + error.name + " " + JSON.stringify(out); } }
class Below extends Array { push(...given) { return super.push("below", ...given); } }
const deeds = { frozen: Object.freeze, sealed: Object.seal, closed: Object.preventExtensions, length: x => Object.defineProperty(x, "length", { writable: false }), own: x => { x.push = function (...given) { return Array.prototype.push.call(this, "own", ...given); }; }, link: x => Object.setPrototypeOf(x, Below.prototype), nothing: () => {} };
for (const [name, deed] of Object.entries(deeds)) console.log(name, freshThen(deed, [1, 2]), "|", on((x => (deed(x), x))(["w"]), [1, 2]));
console.log(on(new Below(), [1, 2]), on({ length: 1, push: Array.prototype.push }, [1, 2]));
