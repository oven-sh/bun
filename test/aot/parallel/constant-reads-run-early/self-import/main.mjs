import * as self from "./main.mjs";
var log = [];
export function early() { return read(); }
log.push(self.early());

var MAX = "_max";
function read() { try { return MAX === undefined ? "early" : MAX; } catch (e) { return e.name; } }
function store(o) { try { o[MAX] = 1; } catch (e) { o.failed = e.name; } return Object.keys(o).join(); }
class Box { constructor() { try { this[MAX] = 2; } catch (e) { this.failed = e.name; } } get keys() { return Object.keys(this).join(); } }
console.log(log.join(" "), read(), store({}), new Box().keys);
