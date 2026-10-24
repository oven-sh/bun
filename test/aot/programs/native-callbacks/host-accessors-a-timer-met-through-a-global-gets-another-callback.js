// A timer is kept under a name of the global object and read back. The store to _onTimeout replaces its callback, which the host then calls without arguments and with the timer as this.
const log = [];
class Meter { constructor() { this.total = 0; } add(by) { this.total += by; return this.total; } }
const meter = new Meter(); meter.add(1);
function first() { log.push("first"); }
function second(...rest) { log.push("second " + rest.length + " " + typeof this + " " + meter.add("x")); console.log(log.join("; ")); }
globalThis.__timer = setTimeout(first, 5);
globalThis.__timer._onTimeout = second;
second.call(undefined, 1);
