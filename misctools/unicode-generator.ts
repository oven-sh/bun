import crypto from "crypto";

// Types to mirror Zig's structures
interface Context<Elem> {
  get(codepoint: number): Promise<Elem> | Elem;
  eql(a: Elem, b: Elem): boolean;
}

interface Tables<Elem> {
  stage1: number[];
  stage2: number[];
  stage3: Elem[];
}

class Generator<Elem> {
  private static readonly BLOCK_SIZE = 256;
  private readonly ctx: Context<Elem>;
  private readonly blockMap = new Map<string, number>();

  constructor(ctx: Context<Elem>) {
    this.ctx = ctx;
  }

  private hashBlock(block: number[]): string {
    const hash = crypto.createHash("sha256");
    hash.update(Buffer.from(new Uint16Array(block).buffer));
    return hash.digest("hex");
  }

  async generate(): Promise<Tables<Elem>> {
    const stage1: number[] = [];
    const stage2: number[] = [];
    const stage3: Elem[] = [];

    let block = new Array(Generator.BLOCK_SIZE).fill(0);
    let blockLen = 0;

    // Maximum Unicode codepoint is 0x10FFFF
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      // Get the mapping for this codepoint
      const elem = await this.ctx.get(cp);

      // Find or add the element in stage3
      let blockIdx = stage3.findIndex(item => this.ctx.eql(item, elem));
      if (blockIdx === -1) {
        blockIdx = stage3.length;
        stage3.push(elem);
      }

      if (blockIdx > 0xffff) {
        throw new Error("Block index too large");
      }

      // Add to current block
      block[blockLen] = blockIdx;
      blockLen++;

      // Check if we need to finalize this block
      if (blockLen < Generator.BLOCK_SIZE && cp !== 0x10ffff) {
        continue;
      }

      // Fill remaining block space with zeros if needed
      if (blockLen < Generator.BLOCK_SIZE) {
        block.fill(0, blockLen);
      }

      // Get or create stage2 index for this block
      const blockHash = this.hashBlock(block);
      let stage2Idx = this.blockMap.get(blockHash);

      if (stage2Idx === undefined) {
        stage2Idx = stage2.length;
        this.blockMap.set(blockHash, stage2Idx);
        stage2.push(...block.slice(0, blockLen));
      }

      if (stage2Idx > 0xffff) {
        throw new Error("Stage2 index too large");
      }

      // Add mapping to stage1
      stage1.push(stage2Idx);

      // Reset block
      block = new Array(Generator.BLOCK_SIZE).fill(0);
      blockLen = 0;
    }

    return { stage1, stage2, stage3 };
  }

  // Generates Zig code for the lookup tables
  static writeZig<Elem>(tableName: string, tables: Tables<Elem>, elemToString: (elem: Elem) => string): string {
    let output = `/// Auto-generated. Do not edit.\n`;
    output += `fn ${tableName}(comptime Elem: type) type {\n`;
    output += "    return struct {\n";

    // Stage 1
    output += `pub const stage1: [${tables.stage1.length}]u16 = .{`;
    output += tables.stage1.join(",");
    output += "};\n\n";

    // Stage 2
    output += `pub const stage2: [${tables.stage2.length}]u8 = .{`;
    output += tables.stage2.join(",");
    output += "};\n\n";

    // Stage 3
    output += `pub const stage3: [${tables.stage3.length}]Elem = .{`;
    output += tables.stage3.map(elemToString).join(",");
    output += "};\n";

    output += "    };\n}\n";
    return output;
  }
}

// Example usage:
async function example() {
  // Example context that maps codepoints to their category
  const ctx: Context<string> = {
    get: async (cp: number) => {
      // This would normally look up the actual Unicode category
      return "Lu";
    },
    eql: (a: string, b: string) => a === b,
  };

  const generator = new Generator(ctx);
  const tables = await generator.generate();

  // Generate Zig code
  const zigCode = Generator.writeZig(tables, (elem: string) => `"${elem}"`);
  console.log(zigCode);
}

export { Generator, type Context, type Tables };
