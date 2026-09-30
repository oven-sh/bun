/**
 * Function addresses and names for a Windows binary, for generate.ts.
 *
 * A PE carries no symbol table — lld-link puts the names in the PDB — so the
 * release link writes two maps next to the binary instead (scripts/build/
 * flags.ts), and they ship in the profile zip with it:
 *
 *   bun-profile.map          lld-link's MSVC-style `/map`: every symbol, by
 *                            address, under the name `/order` knows it by
 *   bun-profile.linker-map   lld's own `/lldmap`: where every input chunk —
 *                            each function's section — was placed
 *
 * The first has the names; the second says which of them are functions. The
 * symbol listing cannot tell: it has every label in `.text`, and the MSVC CRT
 * defines labels on things that are not functions and must not have a
 * breakpoint written over them — arm64 `memset` keeps the byte table its
 * computed branch indexes in `.text` under a symbol named `Table`, and the
 * MSVC-compiled CRT leaves a `$LN123` label on every slot of the jump tables
 * it emits after a function's code. A breakpoint there is a corrupted table,
 * and printf branches into the weeds. Every such label sits inside the chunk
 * of the function it belongs to, while a function starts a chunk of its own:
 * `/Gy` and function sections give each one its own COMDAT, which is also the
 * only thing `/order` can move. So the names kept are the ones at chunk
 * starts; what that drops was never orderable anyway.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

/** `bun-profile.map` for `bun-profile.exe`: the symbol listing. */
export function symbolMapFor(exe: string): string {
  return exe.replace(/\.exe$/i, "") + ".map";
}

/** `bun-profile.linker-map` for `bun-profile.exe`: lld's own map, of chunks. */
export function linkerMapFor(exe: string): string {
  return exe.replace(/\.exe$/i, "") + ".linker-map";
}

/**
 * Names by link-time address for every function in the binary — every name at
 * the start of a chunk in a code section. Several names can share an address
 * (aliases, and functions the linker folded together), and all are kept: the
 * order file has to list whichever of them the linker knows the function by.
 */
export function readWindowsTextSymbols(exe: string): Map<number, string[]> {
  const symbolMap = symbolMapFor(exe);
  const linkerMap = linkerMapFor(exe);
  for (const map of [symbolMap, linkerMap]) {
    if (!existsSync(map)) {
      throw new Error(
        `${map} not found — the release link writes it (the /map and /lldmap flags in scripts/build/flags.ts), ` +
          `and it ships beside ${basename(exe)}`,
      );
    }
  }

  const chunkStarts = parseChunkStarts(readFileSync(linkerMap, "utf8"));
  if (chunkStarts.size === 0) throw new Error(`${linkerMap} lists no chunks — is it lld's map?`);
  const listing = parseSymbolMap(readFileSync(symbolMap, "utf8"));
  if (listing.symbols.length === 0) throw new Error(`${symbolMap} lists no code symbols — is it lld-link's map?`);

  const functions = new Map<number, string[]>();
  for (const [address, name] of listing.symbols) {
    if (!chunkStarts.has(address - listing.imageBase)) continue;
    const names = functions.get(address);
    if (names) names.push(name);
    else functions.set(address, [name]);
  }
  if (functions.size === 0) {
    throw new Error(`none of ${symbolMap}'s symbols start a chunk of ${linkerMap} — are they from the same link?`);
  }
  return functions;
}

export interface SymbolListing {
  /** What the addresses are relative to; lld's map counts from here. */
  imageBase: number;
  /** Every symbol in a code section, in the listing's order: publics, then statics. */
  symbols: [address: number, name: string][];
}

/**
 * The MSVC-style map. A header names the image base, a section table gives
 * each output section's class, then "Publics by Value" and "Static symbols"
 * each list one symbol per line with its `section:offset`, name and address:
 *
 *      Preferred load address is 0000000140000000
 *
 *      Start         Length     Name                   Class
 *      0001:00000000 02f1a2c0H .text                   CODE
 *      0002:00000000 00a3b120H .rdata                  DATA
 *
 *      0001:000004c0       ?main@@YAHHPEAPEAD@Z       00000001400014c0     bun.obj
 *
 * Only the code sections' symbols are of interest: section 0000 holds absolute
 * symbols, and the data sections nothing a breakpoint belongs on. Names can
 * exceed their column, which is why the address is matched after whitespace
 * rather than at a fixed offset. The addresses include the image base.
 */
export function parseSymbolMap(map: string): SymbolListing {
  let imageBase: number | undefined;
  const codeSections = new Set<string>();
  const symbols: SymbolListing["symbols"] = [];
  for (const line of map.split("\n")) {
    const base = /^ Preferred load address is ([0-9a-f]+)/.exec(line);
    if (base) {
      imageBase = parseInt(base[1]!, 16);
      continue;
    }
    const section = /^ ([0-9a-f]{4}):[0-9a-f]{8} [0-9a-f]{8}H \S+\s+CODE\s*$/.exec(line);
    if (section) {
      codeSections.add(section[1]!);
      continue;
    }
    const symbol = /^ ([0-9a-f]{4}):[0-9a-f]{8}\s+(\S+)\s+([0-9a-f]{16})\s/.exec(line);
    if (symbol && codeSections.has(symbol[1]!)) symbols.push([parseInt(symbol[3]!, 16), symbol[2]!]);
  }
  if (imageBase === undefined) throw new Error("the symbol listing has no image base — is it lld-link's /map output?");
  return { imageBase, symbols };
}

/**
 * lld's own map: the address, size and alignment of each output section, of
 * each input chunk placed in it (`object:(section)`), and of each symbol in
 * the chunk, which it lists with size and alignment 0 and under a demangled
 * name — so the names are taken from the other map, and only the chunks from
 * this one:
 *
 *     Address  Size     Align Out     In      Symbol
 *     00001000 02f1a2c0  4096 .text
 *     00001000 00000034    16         bun.obj:(.text$mn)
 *     00001000 00000000     0                 int __cdecl main(int, char **)
 *
 * Returns the address of every chunk, relative to the image base like all of
 * this map's addresses. Chunks of every section are included; a data chunk
 * cannot share an address with a code symbol, so there is nothing to filter.
 */
export function parseChunkStarts(map: string): Set<number> {
  const starts = new Set<number>();
  for (const line of map.split("\n")) {
    const m = /^([0-9a-f]+) [0-9a-f]+ +(\d+) +(.*)$/.exec(line);
    if (m && m[2] !== "0" && m[3]!.includes(":(")) starts.add(parseInt(m[1]!, 16));
  }
  return starts;
}
