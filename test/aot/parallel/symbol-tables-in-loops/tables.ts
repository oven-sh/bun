class Sym { escapedName: string; flags: number; constructor(name: string, flags: number) { this.escapedName = name; this.flags = flags; } }
type SymbolTable = Map<string, Sym>;
const g: any = globalThis;
function createSymbolTable(symbols?: readonly Sym[]): SymbolTable {
    const result = new Map<string, Sym>();
    if (symbols) { for (const symbol of symbols) { result.set(symbol.escapedName, symbol); } }
    return result;
}
function isThisless(symbol: Sym): boolean { return !!(symbol.flags & 4); }
function instantiateSymbol(symbol: Sym, mapper: any): Sym { return g.instantiate(symbol, mapper); }
function createInstantiatedSymbolTable(symbols: Sym[], mapper: any, mappingThisOnly: boolean): SymbolTable {
    const result = createSymbolTable();
    for (const symbol of symbols) { result.set(symbol.escapedName, mappingThisOnly && isThisless(symbol) ? symbol : instantiateSymbol(symbol, mapper)); }
    return result;
}
function createPlain(symbols: Sym[]): SymbolTable { const result = new Map<string, Sym>(); for (const symbol of symbols) { result.set(symbol.escapedName, symbol); } return result; }
g.instantiate = (s: Sym, m: any) => m ? new Sym(s.escapedName, s.flags | 8) : s;
g.create = createInstantiatedSymbolTable; g.createTable = createSymbolTable; g.plain = createPlain;
const lists: Sym[][] = []; for (let n = 0; n < 40; n++) { const list: Sym[] = []; for (let k = 0; k < n; k++) list.push(new Sym("s" + k, k & 7)); lists.push(list); }
g.lists = lists; let total = 0; for (let t = 0; t < 20; t++) for (let n = 0; n < 40; n++) total += g.create(g.lists[n], t & 1, true).size + g.plain(g.lists[n]).size;
console.log(total, g.createTable().size, g.createTable(lists[9]).size);
