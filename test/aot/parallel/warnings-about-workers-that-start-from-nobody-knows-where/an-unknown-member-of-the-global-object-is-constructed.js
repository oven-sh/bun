// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
globalThis.Gauge = class { constructor(level) { this.level = level; } };
console.log(new globalThis.Gauge(4).level);
