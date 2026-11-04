// `bun <file>` leaves the statement out, so nothing throws. A read that takes the value throws.
function touch() { try { late; return "no throw"; } catch (e) { return e.name; } }
function take() { try { return String(late); } catch (e) { return e.name; } }
console.log(touch(), take());
let late = Number("1");
console.log(touch(), take());
