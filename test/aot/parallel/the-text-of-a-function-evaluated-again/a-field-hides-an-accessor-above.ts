// The field that a parameter property declares hides an accessor of the class above, so the store never calls its setter.
const told: string[] = [];
const Above: any = class { set level(value: number) { told.push("set " + value); } get level() { return -1; } };
class Under extends Above { constructor(public level: number) { super(); } }
const Again = (0, eval)("(function (Above) { return (" + String(Under) + "); })")(Above);
for (const Made of [Under, Again]) {
  const made = new Made(6);
  console.log(made.level, Object.keys(made).join(), told.length);
}
