// A class that nobody uses is defined below a heritage that has been one of two classes so far, and is now no constructor, or a function whose `prototype` is no object: the definition throws all the same.
class A { }
class C { }
function NumberBelow() { }
NumberBelow.prototype = 5;
function NullBelow() { }
NullBelow.prototype = null;
const arrow = () => 1;
function define(Base) { class Dropped extends Base { } return "defined"; }
function belowNumber() { try { class Dropped extends NumberBelow { } return "defined"; } catch (error) { return error.name; } }
function belowNull() { try { class Dropped extends NullBelow { } return "defined"; } catch (error) { return error.name; } }
function belowArrow() { try { class Dropped extends arrow { } return "defined"; } catch (error) { return error.name; } }
function belowMax() { try { class Dropped extends Math.max { } return "defined"; } catch (error) { return error.name; } }
function belowClassOrNumber(flag) { const Base = flag ? A : NumberBelow; try { class Dropped extends Base { } return "defined"; } catch (error) { return error.name; } }
function belowClassOrArrow(flag) { const Base = flag ? C : arrow; try { class Dropped extends Base { } return "defined"; } catch (error) { return error.name; } }

function deed(Base) {
  try { return define(Base); } catch (error) { return error.name; }
}
let said = "";
for (let i = 0; i < 200; i++) said = deed(i & 1 ? A : C);
console.log(said);
console.log(deed(undefined), deed(5), deed("A"), deed({}), deed(arrow), deed(async function () { }), deed(function* () { }), deed(Math.max), deed(NumberBelow), deed(NullBelow), deed(null), deed(Map), deed(A.bind(null)));
console.log(belowNumber(), belowNull(), belowArrow(), belowMax());
for (let i = 0; i < 200; i++) said = deed(i % 3 ? A : NumberBelow) + belowNumber() + belowArrow();
console.log(said, deed(A), deed(C));
console.log(belowClassOrNumber(true), belowClassOrNumber(false), belowClassOrArrow(true), belowClassOrArrow(false));
for (let i = 0; i < 200; i++) said = belowClassOrNumber(i % 3 !== 0) + belowClassOrArrow(i % 3 !== 0);
console.log(said);
