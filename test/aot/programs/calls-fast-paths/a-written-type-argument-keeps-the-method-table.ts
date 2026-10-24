// A type argument that the program writes at a call of a generic method says nothing about how the method is called: both calls go through the method table
// STATISTIC: TableCalls >= 2
interface Row { id: number }
interface Store { find<T>(id: number): T }
class Store1 implements Store { row: Row = { id: 1 }; find<T>(id: number): T { this.row.id = id + 1; return this.row as unknown as T; } }
class Store2 implements Store { row: Row = { id: 2 }; find<T>(id: number): T { this.row.id = id + 2; return this.row as unknown as T; } }
class Store3 implements Store { row: Row = { id: 3 }; find<T>(id: number): T { this.row.id = id + 3; return this.row as unknown as T; } }
class Store4 implements Store { row: Row = { id: 4 }; find<T>(id: number): T { this.row.id = id + 4; return this.row as unknown as T; } }
class Store5 implements Store { row: Row = { id: 5 }; find<T>(id: number): T { this.row.id = id + 5; return this.row as unknown as T; } }
class Store6 implements Store { row: Row = { id: 6 }; find<T>(id: number): T { this.row.id = id + 6; return this.row as unknown as T; } }
function findWritten(store: Store, id: number): number { return store.find<Row>(id).id; }
function findCast(store: Store, id: number): number { return (store.find(id) as Row).id; }

const stores: Store[] = [new Store1(), new Store2(), new Store3(), new Store4(), new Store5(), new Store6()];
let total = 0;
for (let i = 0; i < 6000; i++) total += findWritten(stores[i % 6], i & 3) * 2 + findCast(stores[i % 6], i & 3);

// A stranger reaches both functions, so that no parameter is known from its callers alone.
const stranger: any = JSON.parse(process.argv[2] ?? "null");
if (stranger !== null) for (const f of [findWritten, findCast] as any[]) total += f(stranger, stranger);
console.log(total);
