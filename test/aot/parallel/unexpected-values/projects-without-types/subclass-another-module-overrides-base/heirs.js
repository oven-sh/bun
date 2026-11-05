import { Queue } from "./queue.js";

export const log = [];
export class TextItems extends Queue {
  constructor() {
    super();
    this.items = "ab";
  }
}
export class GetterItems extends Queue {
  get items() {
    log.push("get items");
    return [1, 2];
  }
  set items(value) {
    log.push("set items");
  }
}
export class TextSize extends Queue {
  size() {
    return "2";
  }
}
export class TextLimit extends Queue {
  limit = "3";
}
export class FieldOverMethod extends Queue {
  size = () => 1;
}
export class SetItems extends Queue {
  constructor() {
    super();
    this.items = new Set([1, 2]);
  }
}
export class LikeItems extends Queue {
  constructor() {
    super();
    this.items = { length: 1, 0: 7, push: () => "own push", [Symbol.iterator]: () => [7, 8][Symbol.iterator]() };
  }
}
export class NoItems extends Queue {
  constructor() {
    super();
    delete this.items;
  }
}
export class BigLimit extends Queue {
  limit = 3n;
}
