// Methods found through instances: Object.assign stores through the setters of a class with whatever the sources hold, here strings and null out of JSON.parse, while every store in the program is a number.
let total = 0;

class Settings {
  #size = 0;
  set size(value: number) {
    total += typeof value === "number" ? 1 : typeof value === "string" ? 100 : value === null ? 10000 : 1000000;
    this.#size = value;
  }
  get size(): number {
    return this.#size;
  }
}

const settings = new Settings();
settings.size = 4;
Object.assign(settings, { size: 5 });
const first = settings.size + 1;
Object.assign(settings, JSON.parse('{"size":"6"}'));
const second = settings.size + 1;
Object.assign(settings, JSON.parse('{"size":null}'), { size: [7] } as any);
const third = settings.size + 1;
console.log(total, first, second, third, typeof settings.size);
