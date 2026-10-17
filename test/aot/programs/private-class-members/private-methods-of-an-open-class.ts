// A call of a private method on a class that also takes untyped objects tests the shape and calls the method directly; an untyped heir and an object without the method take the general path.
class Pool {
  served = 0;
  #next(): boolean {
    this.served++;
    return this.served < 3;
  }
  #drain(): void {
    while (this.#next());
  }
  drain(): number {
    this.#drain();
    return this.served;
  }
  static drainOf(other: Pool): number {
    other.#drain();
    return other.served;
  }
}
const Untyped: any = Pool;
class Heir extends Untyped {
  extra = 1;
}
const taken: any[] = [new Heir(), new Pool()];
const heir = taken[0] as Pool;
const pool = taken[1] as Pool;
console.log(heir.drain(), pool.drain());
for (const other of [{ served: 0 }, null, undefined, 1]) {
  try {
    console.log(Pool.drainOf(other as any));
  } catch (error) {
    console.log((error as Error).name);
  }
}
