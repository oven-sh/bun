export class SQLResultArray<T = any> extends Array<T> {
  public count: number | null = null;
  public command: string | null = null;

  constructor(...args: any[]) {
    super(
      ...(args.length > 1 ||
      (args.length === 1 && typeof args[0] === "number")
        ? args
        : [0])
    ); // Handles Array(len) vs Array(...items)
    if (args.length === 1 && Array.isArray(args[0])) {
      args[0].forEach((item) => this.push(item));
    } else if (
      args.length > 1 ||
      (args.length === 1 && typeof args[0] !== "number")
    ) {
      args.forEach((item) => this.push(item));
    }

    Object.defineProperties(this, {
      count: {
        value: null,
        writable: true,
        enumerable: false,
        configurable: true,
      },
      command: {
        value: null,
        writable: true,
        enumerable: false,
        configurable: true,
      },
    });
  }

  static get [Symbol.species]() {
    return Array;
  }
}

Object.defineProperty(SQLResultArray, Symbol.toStringTag, {
  value: "SQLResults",
  configurable: true,
});
