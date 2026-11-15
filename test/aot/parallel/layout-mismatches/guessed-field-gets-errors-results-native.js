// An error that the run time throws, a structured clone and a URL are stored into a field that the constructor fills with null.
const log = [];
function Node1() { this.next = null; }
const a = new Node1(), b = new Node1(), c = new Node1(), d = new Node1();
a.next = b;
try { null.x; } catch (error) { b.next = error; }
c.next = structuredClone({ deep: [1] }); d.next = new URL("http://h/p");
log.push(a.next === b, b.next instanceof TypeError, typeof b.next.message, c.next.deep[0], d.next.pathname);
try { a.next.next.next.next; log.push("read"); a.next.next.next.next.x; } catch (error) { log.push(error.constructor.name); }
console.log(log.join("; "));
