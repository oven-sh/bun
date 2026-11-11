// A legacy decorator is handed the key of its member as the brackets gave it, in front of its turn into a property key: a number stays a number.
const seen: string[] = [];
const spell = (key: unknown) => `${typeof key} ${Object.is(key, -0) ? "-0" : String(key)}`;
function note(_target: object, key: any, _third?: any) { seen.push(spell(key)); }
function noteParameter(_target: object, key: any, index: number) { seen.push(`parameter ${index} of ${spell(key)}`); }
const one = 1, five = 5, seven = 7, nine = 9, eleven = 11, thirteen = 13, fifteen = 15, word = "worded", minusZero = -0, half = 0.5, huge = 1e21;
const sum = 1 + one;
const big: any = 10n;
class Holder {
  @note [one]() {}
  @note [word]() {}
  @note ["written"]() {}
  @note [3]() {}
  @note get [five]() { return 0; }
  @note set [seven](_value: number) {}
  @note static [nine]() {}
  @note [eleven] = 0;
  @note static [thirteen] = 0;
  @note [minusZero]() {}
  @note [half]() {}
  @note [huge]() {}
  [fifteen](@noteParameter _value: number) {}
}
class Reckoned {
  @note [sum]() {}
  @note [`${word}/more`]() {}
  @note [2 * five]() {}
  @note static [sum + five]() {}
}
class Large {
  @note [big]() {}
}
for (const line of seen) console.log(line);
for (const holder of [Holder.prototype, Holder, new Holder(), Reckoned.prototype, Reckoned, Large.prototype]) console.log(Object.getOwnPropertyNames(holder).join(" "));
