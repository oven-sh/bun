const keyOfX: string = JSON.parse('"x"');
const keyOfExtra: string = JSON.parse('"extra"');
const keyOfZero: string = JSON.parse('"0"');
const turns: number = JSON.parse("3");
interface Options {
  x?: number;
  y: number;
}
function read(options: Options) {
  return options.x === undefined ? "none" : options.x + options.y;
}
function empty(options: Options, key: string) {
  delete (options as any)[key];
}
const given: Options = { x: 1, y: 2 };
console.log(read(given), read({ y: 5 }));
empty(given, keyOfX);
console.log(read(given), Object.keys(given).join(), new Map([[1, given.x]]).get(1), [given.x].length);
