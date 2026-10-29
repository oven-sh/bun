// Export names that are not identifiers, not ASCII, or prefixes of each other.
const a = 1, b = 2, c = 3, d = 4, e = 5, f = 6, g = 7, h = 8, i = 9;
export { a as "", b as "a", c as "a b", d as "ab", e as "\u00e9", f as "\u65e5\u672c", g as "\ud835\udcb3", h as "Z", i as "z" };
export default 10;
