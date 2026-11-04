// A boolean and a number, wherever an object stands among the operands.
import { isDeepStrictEqual } from "node:util";
function same(...operands) { return isDeepStrictEqual(...operands); }
const extra = { more: 1 };
console.log(same({ a: 1 }, { a: 1 }), same([1], [2]), typeof same(1, 1), same(), same(1), same(undefined));
console.log(same({}, {}, extra), same(1, 1, extra, extra, extra, extra, extra, extra), same(extra, extra, 1, 2, 3, 4, 5, extra));
function width(...operands) { return Bun.stringWidth(...operands); }
console.log(width("abc"), typeof width(), width("abc", extra), width("abc", { countAnsiEscapeCodes: true }, extra), width("a", 1, 2, 3, 4, 5, extra));
for (const odd of [extra, null, 1, Symbol.iterator]) try { console.log(width(odd)); } catch (error) { console.log(error.name); }
class Holder { first = isDeepStrictEqual(extra, extra, extra); second = Bun.stringWidth("ab", extra, extra); }
console.log(new Holder().first, new Holder().second);
