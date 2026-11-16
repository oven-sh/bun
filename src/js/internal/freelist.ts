class FreeList<T> {
  name: string;
  max: number;
  /** Called with `new`; what it returns is the object. */
  ctor: (...args: any[]) => T;
  list: T[];

  constructor(name: string, max: number, ctor: (...args: any[]) => T) {
    this.name = name;
    this.ctor = ctor;
    this.max = max;
    this.list = [];
  }

  alloc(): T {
    return this.list.length > 0
      ? this.list.pop()!
      : new (this.ctor as unknown as new (...args: any[]) => T)(...arguments);
  }

  free(obj: T) {
    if (this.list.length < this.max) {
      this.list.push(obj);
      return true;
    }
    return false;
  }
}

export default FreeList;
