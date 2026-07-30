// Aggressive crash-hunting: boundary values, type confusion, prototype poisoning
const probes = [
  // Prototype poisoning
  `Object.prototype.calendar = {toString(){throw 1}}; Temporal.PlainDate.from({year:2025,month:1,day:1})`,
  `Object.prototype.timeZone = {toString(){return "x".repeat(1e6)}}; Temporal.Now.zonedDateTimeISO()`,
  `Array.prototype[Symbol.iterator] = function*(){throw 1}; Temporal.PlainDate.from("2025-01-01")`,
  // Re-entrancy via getters
  `let n=0; Temporal.PlainDate.from({get year(){return ++n>3?2025:Temporal.PlainDate.from(this)},month:1,day:1})`,
  // toString re-entrancy
  `let d; const evil={toString(){d.add({days:1});return "iso8601"}}; d=new Temporal.PlainDate(2025,1,1); d.withCalendar(evil)`,
  // Boundary epochs
  `new Temporal.Instant(8640000000000000000000000n)`,
  `new Temporal.Instant(-8640000000000000000000001n)`,
  `Temporal.Instant.fromEpochNanoseconds((2n**128n))`,
  // Huge strings
  `Temporal.Instant.from("2025-01-01T00:00:00"+".0".repeat(1e5)+"Z")`,
  `Temporal.PlainDate.from("2025-01-01["+"x".repeat(1e7)+"]")`,
  `Temporal.Duration.from("P"+"1".repeat(1e6)+"D")`,
  `Temporal.ZonedDateTime.from("2025-01-01[UTC]["+"u-ca=x".repeat(1e5)+"]")`,
  // Weird calendar/tz
  `new Temporal.ZonedDateTime(0n, "\u0000")`,
  `new Temporal.ZonedDateTime(0n, "A".repeat(1000))`,
  `new Temporal.PlainDate(2025,1,1,"__proto__")`,
  `new Temporal.PlainDate(2025,1,1,"")`,
  `new Temporal.PlainDate(2025,1,1,"x".repeat(1e6))`,
  // Duration math overflow
  `Temporal.Duration.from({nanoseconds: Number.MAX_SAFE_INTEGER}).add({nanoseconds: Number.MAX_SAFE_INTEGER})`,
  `new Temporal.Duration(2**31,2**31,2**31,2**31,2**31,2**31,2**31,2**31,2**31,2**31)`,
  `Temporal.Duration.from({days:Number.MAX_VALUE}).total("nanoseconds")`,
  // round with huge increment
  `new Temporal.PlainTime(12).round({smallestUnit:"nanosecond",roundingIncrement:2**53})`,
  `new Temporal.Instant(0n).round({smallestUnit:"hour",roundingIncrement:0})`,
  `new Temporal.Instant(0n).round({smallestUnit:"hour",roundingIncrement:-1})`,
  `new Temporal.Instant(0n).round({smallestUnit:"hour",roundingIncrement:NaN})`,
  `new Temporal.Instant(0n).round({smallestUnit:"hour",roundingIncrement:Infinity})`,
  // with() poisoning
  `new Temporal.PlainDate(2025,1,1).with({get month(){Object.defineProperty(this,"day",{get(){throw 1}});return 5}})`,
  // Symbol coercion
  `Temporal.Instant.from(Symbol())`,
  `new Temporal.ZonedDateTime(0n, Symbol())`,
  // Proxy traps
  `Temporal.PlainDate.from(new Proxy({},{get(){throw new Error("trap")}}))`,
  `Temporal.Duration.from(new Proxy({},{ownKeys(){return ["years"]},getOwnPropertyDescriptor(){return{value:1,enumerable:true,configurable:true}}}))`,
  // GC pressure
  `for(let i=0;i<1e4;i++){new Temporal.ZonedDateTime(BigInt(i),"UTC")}`,
  `for(let i=0;i<1e4;i++){Temporal.PlainDate.from("2025-01-01[u-ca=hebrew]").year}`,
  // Nested annotations
  `Temporal.PlainDate.from("2025-01-01"+Array(100).fill("[u-ca=iso8601]").join(""))`,
  // Invalid UTF-8 / surrogate
  `Temporal.PlainDate.from("2025-01-01[\ud800]")`,
  `Temporal.PlainDate.from("2025-01-01[\udfff]")`,
];
let crashes = 0, throws = 0, ok = 0;
for (let i = 0; i < probes.length; i++) {
  try {
    Function(probes[i])();
    ok++;
  } catch(e) {
    throws++;
  }
}
print(`probes=${probes.length} ok=${ok} throws=${throws}`);
