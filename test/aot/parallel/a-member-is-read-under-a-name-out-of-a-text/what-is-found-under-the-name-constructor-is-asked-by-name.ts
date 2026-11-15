const first: any = JSON.parse('"constructor"');
const list = [1, 2];
const maker = (list as any)[first];
console.log(
  maker === Array,
  maker.from("ab").join(),
  maker.isArray(list),
  maker.of(7).length,
  new maker(3).length,
  maker.name,
  maker.prototype === Array.prototype,
);
const ofText = ("a" as any)[first];
console.log(ofText === String, ofText.fromCharCode(65), ofText(12), ofText.raw`x`, ofText.fromCodePoint(66));
const ofMap = (new Map() as any)[first];
console.log(
  ofMap === Map,
  new ofMap([[1, 2]]).get(1),
  ofMap
    .groupBy([1, 2, 3], (n: number) => n % 2)
    .get(1)
    .join(),
);
const ofNumber = (5 as any)[first];
console.log(ofNumber === Number, ofNumber.isInteger(5), ofNumber.parseFloat("1.5"), ofNumber.MAX_SAFE_INTEGER);
const above = (list as any)[JSON.parse('"__proto__"')];
console.log(
  above === Array.prototype,
  typeof above.map,
  above.concat.call([1], 2).join(),
  Object.getPrototypeOf(above) === Object.prototype,
);
