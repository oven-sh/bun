// The first read of a variable that holds a RegExp stands in a loop that calls nothing and stores nothing: there is one RegExp, and it keeps its lastIndex.
import { same, read } from "./m.mjs";
console.log(same(0), same(300));
read().test("xaay");
console.log(same(3), read().lastIndex, read() === read());
