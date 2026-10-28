export interface HasArea {
  area(): number
}
export class Base {
  static made = 0
  static tally(): string {
    return 'made ' + Base.made
  }
  name: string
  constructor(name: string) {
    this.name = name
    Base.made++
  }
  describe(): string {
    return 'a ' + this.name
  }
}
export const Held = class {
  kept = 1
}
export let Replaced: new () => object = class {
  first = 1
}
Replaced = class {
  second = 2
}
