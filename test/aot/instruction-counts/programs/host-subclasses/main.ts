// Instances of classes that extend host classes
class PlainPromise extends Promise<number> {}
class PromiseWithFields extends Promise<number> {
  started = false;
  label = "lazy";
}
class MapWithFields extends Map<string, number> {
  reads = 0;
  writes = 0;
}
class ErrorWithFields extends Error {
  status = 500;
  code = "E_FAILED";
}
class PlainArray extends Array<number> {}
class ArrayWithFields extends Array<number> {
  count = 0;
  command = "SELECT";
}
class ArrayWithPrivateFields extends Array<number> {
  #count: number | null = null;
  #command: string | null = null;
  #lastInsertRowid: number | null = null;
  #affectedRows: number | null = null;
  #statement: object | null = null;
  #undescribed = -1;
  get count(): number {
    return (this.#count ?? 0) + this.#undescribed + (this.#command ?? "").length + (this.#lastInsertRowid ?? 0) + (this.#affectedRows ?? 0) + (this.#statement === null ? 1 : 0);
  }
}

const executor = (resolve: (value: number) => void) => resolve(1);

function repeat(make: (turn: number) => number): (turns: number) => number {
  return turns => {
    let total = 0;
    for (let turn = 0; turn < turns; turn++) total += make(turn);
    return total;
  };
}

const cases: Record<string, (turns: number) => number> = {
  "0 empty loop": repeat(turn => turn & 1),
  "1 a Promise": repeat(() => (new Promise<number>(executor) instanceof Promise ? 1 : 0)),
  "1 a subclass of Promise": repeat(() => (new PlainPromise(executor) instanceof Promise ? 1 : 0)),
  "1 a subclass of Promise with two fields": repeat(() => new PromiseWithFields(executor).label.length),
  "2 a subclass of Map with two fields": repeat(turn => new MapWithFields().reads + turn),
  "3 a subclass of Error with two fields": repeat(() => new ErrorWithFields("failed").status),
  "4 a subclass of Array": repeat(() => new PlainArray().length),
  "4 a subclass of Array with two fields": repeat(() => new ArrayWithFields().command.length),
  "4 a subclass of Array with six private fields": repeat(() => new ArrayWithPrivateFields().count),
};

const name = process.argv[2]!;
if (name === "names") console.log(Object.keys(cases).join("\n"));
else {
  let last = 0;
  for (const turns of process.argv.slice(3)) {
    last = cases[name]!(Number(turns));
    process.kill(process.pid, 0);
  }
  console.log(last);
}
