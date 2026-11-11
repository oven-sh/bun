/** @jsx make */
var log = [];
var e = <p />; log.push(e);
function make() { log.push(read()); return store({}) + new Box().keys; }

var MAX = "_max";
function read() { try { return MAX === undefined ? "early" : MAX; } catch (e) { return e.name; } }
function store(o) { try { o[MAX] = 1; } catch (e) { o.failed = e.name; } return Object.keys(o).join(); }
class Box { constructor() { try { this[MAX] = 2; } catch (e) { this.failed = e.name; } } get keys() { return Object.keys(this).join(); } }
console.log(log.join(" "), read(), store({}), new Box().keys);
