const add = (a: number, b?: number): number => (a as number) + (b ?? 0)!;

function first<T>(this: void, list: T[]): T {
  return list[0]!;
}

class Box<T> {
  private value: T;
  constructor(value: T) {
    this.value = value;
  }
  get(): T {
    return this.value satisfies T;
  }
}

const hasTypes = /number|<T>|: T|\bas\b|\bsatisfies\b|private|this: void|!/;
for (const text of [add.toString(), first.toString(), Box.toString(), Box.prototype.get.toString()])
  console.log(hasTypes.test(text));
