// A variable is declared to hold a list or a record and is given a boolean and a wrapped number. Inside a loop a literal takes it, and a closure reads it back under another type.
interface Named {
  name: Named;
}
interface Optional {
  b?: number;
}
function isOptional(value: unknown): value is Optional {
  return true;
}
function readEmptyHolder<T>(value: T): T {
  const holder: { held?: T } = {};
  return holder.held as T;
}
console.log(readEmptyHolder<boolean>(new Map<number, Named>() as any));

const kept: unknown[] = [];
function fillHolders(given: unknown): void {
  const value: string[] | string | Named = given as any;
  for (let turn = 0; turn < 3; turn++) {
    if ("object" === typeof value) {
      const holder: { held: string[] | Named } = { held: value };
      console.log(
        String(
          (() => {
            if (!isOptional(holder.held)) return holder.held;
            return holder.held.b;
          })(),
        ),
      );
      kept.push(holder);
    }
  }
}
fillHolders(false);
fillHolders(new Number(3));

for (const holder of kept as any[]) {
  console.log(
    Object.keys(holder),
    JSON.stringify(holder),
    Object.entries(holder).length,
    typeof holder.held,
    String(holder.held),
    { ...holder }.held === holder.held,
    holder.held instanceof Number,
    holder.held + 1,
  );
}
