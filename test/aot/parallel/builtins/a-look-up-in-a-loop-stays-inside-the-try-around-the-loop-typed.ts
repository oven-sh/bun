// Flags: --aot-verify-each-pass
// With types: the key is a string, which may have been joined.
const key: string = ["a"].join("");
function has(map: Map<string, number>, key: string, turns: number): string { let found = 0; try { for (let i = 0; i < turns; i++) { if (map.has(key)) found++; } } catch (error) { return "caught " + (error as Error).name; } return "found " + found; }
function same(turns: number): boolean { const held = new Map<string, object>([["a", {}]]); const first = held.get(key); let same = true; try { for (let i = 0; i < turns; i++) same &&= held.get(key) === first; } catch (error) { throw error; } finally { turns = 0; } return same; }
class Names { names = new Set<string>(["a"]); count(key: string, turns: number): number { let found = 0; try { for (let i = 0; i < turns; i++) { if (this.names.has(key)) found++; } } catch { return -1; } return found; } }
console.log(has(new Map([["a", 1]]), key, 3), has(new Map(), key, 3), same(4), same(0), new Names().count(key, 5), new Names().count("b", 5));
