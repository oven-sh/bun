// The name of the setter stands as the target of a loop, of a pattern, of a compound assignment and of an update.
const meter = { raw: 0, log: "", get value() { return this.raw; }, set value(next) { this.log += next + ";"; this.raw = next; } };
for (meter.value of [1, 2]);
for (meter.value in { a: 0, b: 0 });
[meter.value] = [3];
({ x: meter.value } = { x: 4 });
[meter.value = 5] = [];
({ ...meter.value } = { y: 1 });
meter.value = 6;
meter.value += 2;
meter.value++;
--meter.value;
meter.value &&= 10;
meter.value ||= 11;
meter.value ??= 12;
console.log(meter.log, meter.raw);
