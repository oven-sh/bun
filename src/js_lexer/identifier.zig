// This file benchmarks different approaches for determinig whether or not a unicode codepoint is possibly a JS identifier
// these values are copy-pasted from "typescript/lib/typescriptServices.js"
const std = @import("std");
pub const SerializedBitset = extern struct {};

pub const Bitset = struct {
    const Cache = @import("identifier_cache.zig");
    const id_start_range: [2]i32 = Cache.id_start_meta.range;
    const id_end_range: [2]i32 = Cache.id_continue_meta.range;
    // this is a pointer because otherwise it may be copied onto the stack
    // and it's a huge bitset
    const id_start = &Cache.id_start;
    // this is a pointer because otherwise it may be copied onto the stack
    // and it's a huge bitset
    const id_continue = &Cache.id_continue;

    pub fn init() void {}

    pub fn isIdentifierStart(codepoint: i32) bool {
        return codepoint >= (comptime id_start_range[0]) and
            codepoint <= (comptime id_start_range[1]) and
            id_start.isSet((comptime @as(usize, @intCast(id_start_range[1]))) - @as(
            usize,
            @intCast(codepoint),
        ));
    }

    pub fn isIdentifierPart(codepoint: i32) bool {
        return codepoint >= (comptime id_end_range[0]) and
            codepoint <= (comptime id_end_range[1]) and
            id_continue.isSet(
            (comptime @as(usize, @intCast(id_end_range[1]))) - @as(
                usize,
                @intCast(codepoint),
            ),
        );
    }
};

/// In WASM, we use the JumpTable version
pub const JumpTable = struct {
    const minInt = @import("std").math.minInt;
    const maxInt = @import("std").math.maxInt;
    const max_codepoint = 0x10FFFF;
    noinline fn isIdentifierPartSlow(codepoint: i32) bool {
        @setCold(true);
        return switch (codepoint) {
            // explicitly tell LLVM's optimizer about values we know will not be in the range of this switch statement
            0xaa...0xffd7 => isIdentifierPartSlow16(@as(u16, @intCast(codepoint))),
            (0xffd7 + 1)...0xe01ef => isIdentifierPartSlow32(codepoint),

            else => false,
        };
    }

    fn isIdentifierPartSlow16(codepoint: u16) bool {
        return switch (codepoint) {
            minInt(u16)...(0xaa - 1) => unreachable,
            0xaa...0xaa, 0xb5...0xb5, 0xb7...0xb7, 0xba...0xba, 0xc0...0xd6, 0xd8...0xf6, 0xf8...0x2c1, 0x2c6...0x2d1, 0x2e0...0x2e4, 0x2ec...0x2ec, 0x2ee...0x2ee, 0x300...0x374, 0x376...0x377, 0x37a...0x37d, 0x37f...0x37f, 0x386...0x38a, 0x38c...0x38c, 0x38e...0x3a1, 0x3a3...0x3f5, 0x3f7...0x481, 0x483...0x487, 0x48a...0x52f, 0x531...0x556, 0x559...0x559, 0x560...0x588, 0x591...0x5bd, 0x5bf...0x5bf, 0x5c1...0x5c2, 0x5c4...0x5c5, 0x5c7...0x5c7, 0x5d0...0x5ea, 0x5ef...0x5f2, 0x610...0x61a, 0x620...0x669, 0x66e...0x6d3, 0x6d5...0x6dc, 0x6df...0x6e8, 0x6ea...0x6fc, 0x6ff...0x6ff, 0x710...0x74a, 0x74d...0x7b1, 0x7c0...0x7f5, 0x7fa...0x7fa, 0x7fd...0x7fd, 0x800...0x82d, 0x840...0x85b, 0x860...0x86a, 0x8a0...0x8b4, 0x8b6...0x8c7, 0x8d3...0x8e1, 0x8e3...0x963, 0x966...0x96f, 0x971...0x983, 0x985...0x98c, 0x98f...0x990, 0x993...0x9a8, 0x9aa...0x9b0, 0x9b2...0x9b2, 0x9b6...0x9b9, 0x9bc...0x9c4, 0x9c7...0x9c8, 0x9cb...0x9ce, 0x9d7...0x9d7, 0x9dc...0x9dd, 0x9df...0x9e3, 0x9e6...0x9f1, 0x9fc...0x9fc, 0x9fe...0x9fe, 0xa01...0xa03, 0xa05...0xa0a, 0xa0f...0xa10, 0xa13...0xa28, 0xa2a...0xa30, 0xa32...0xa33, 0xa35...0xa36, 0xa38...0xa39, 0xa3c...0xa3c, 0xa3e...0xa42, 0xa47...0xa48, 0xa4b...0xa4d, 0xa51...0xa51, 0xa59...0xa5c, 0xa5e...0xa5e, 0xa66...0xa75, 0xa81...0xa83, 0xa85...0xa8d, 0xa8f...0xa91, 0xa93...0xaa8, 0xaaa...0xab0, 0xab2...0xab3, 0xab5...0xab9, 0xabc...0xac5, 0xac7...0xac9, 0xacb...0xacd, 0xad0...0xad0, 0xae0...0xae3, 0xae6...0xaef, 0xaf9...0xaff, 0xb01...0xb03, 0xb05...0xb0c, 0xb0f...0xb10, 0xb13...0xb28, 0xb2a...0xb30, 0xb32...0xb33, 0xb35...0xb39, 0xb3c...0xb44, 0xb47...0xb48, 0xb4b...0xb4d, 0xb55...0xb57, 0xb5c...0xb5d, 0xb5f...0xb63, 0xb66...0xb6f, 0xb71...0xb71, 0xb82...0xb83, 0xb85...0xb8a, 0xb8e...0xb90, 0xb92...0xb95, 0xb99...0xb9a, 0xb9c...0xb9c, 0xb9e...0xb9f, 0xba3...0xba4, 0xba8...0xbaa, 0xbae...0xbb9, 0xbbe...0xbc2, 0xbc6...0xbc8, 0xbca...0xbcd, 0xbd0...0xbd0, 0xbd7...0xbd7, 0xbe6...0xbef, 0xc00...0xc0c, 0xc0e...0xc10, 0xc12...0xc28, 0xc2a...0xc39, 0xc3d...0xc44, 0xc46...0xc48, 0xc4a...0xc4d, 0xc55...0xc56, 0xc58...0xc5a, 0xc60...0xc63, 0xc66...0xc6f, 0xc80...0xc83, 0xc85...0xc8c, 0xc8e...0xc90, 0xc92...0xca8, 0xcaa...0xcb3, 0xcb5...0xcb9, 0xcbc...0xcc4, 0xcc6...0xcc8, 0xcca...0xccd, 0xcd5...0xcd6, 0xcde...0xcde, 0xce0...0xce3, 0xce6...0xcef, 0xcf1...0xcf2, 0xd00...0xd0c, 0xd0e...0xd10, 0xd12...0xd44, 0xd46...0xd48, 0xd4a...0xd4e, 0xd54...0xd57, 0xd5f...0xd63, 0xd66...0xd6f, 0xd7a...0xd7f, 0xd81...0xd83, 0xd85...0xd96, 0xd9a...0xdb1, 0xdb3...0xdbb, 0xdbd...0xdbd, 0xdc0...0xdc6, 0xdca...0xdca, 0xdcf...0xdd4, 0xdd6...0xdd6, 0xdd8...0xddf, 0xde6...0xdef, 0xdf2...0xdf3, 0xe01...0xe3a, 0xe40...0xe4e, 0xe50...0xe59, 0xe81...0xe82, 0xe84...0xe84, 0xe86...0xe8a, 0xe8c...0xea3, 0xea5...0xea5, 0xea7...0xebd, 0xec0...0xec4, 0xec6...0xec6, 0xec8...0xecd, 0xed0...0xed9, 0xedc...0xedf, 0xf00...0xf00, 0xf18...0xf19, 0xf20...0xf29, 0xf35...0xf35, 0xf37...0xf37, 0xf39...0xf39, 0xf3e...0xf47, 0xf49...0xf6c, 0xf71...0xf84, 0xf86...0xf97, 0xf99...0xfbc, 0xfc6...0xfc6, 0x1000...0x1049, 0x1050...0x109d, 0x10a0...0x10c5, 0x10c7...0x10c7, 0x10cd...0x10cd, 0x10d0...0x10fa, 0x10fc...0x1248, 0x124a...0x124d, 0x1250...0x1256, 0x1258...0x1258, 0x125a...0x125d, 0x1260...0x1288, 0x128a...0x128d, 0x1290...0x12b0, 0x12b2...0x12b5, 0x12b8...0x12be, 0x12c0...0x12c0, 0x12c2...0x12c5, 0x12c8...0x12d6, 0x12d8...0x1310, 0x1312...0x1315, 0x1318...0x135a, 0x135d...0x135f, 0x1369...0x1371, 0x1380...0x138f, 0x13a0...0x13f5, 0x13f8...0x13fd, 0x1401...0x166c, 0x166f...0x167f, 0x1681...0x169a, 0x16a0...0x16ea, 0x16ee...0x16f8, 0x1700...0x170c, 0x170e...0x1714, 0x1720...0x1734, 0x1740...0x1753, 0x1760...0x176c, 0x176e...0x1770, 0x1772...0x1773, 0x1780...0x17d3, 0x17d7...0x17d7, 0x17dc...0x17dd, 0x17e0...0x17e9, 0x180b...0x180d, 0x1810...0x1819, 0x1820...0x1878, 0x1880...0x18aa, 0x18b0...0x18f5, 0x1900...0x191e, 0x1920...0x192b, 0x1930...0x193b, 0x1946...0x196d, 0x1970...0x1974, 0x1980...0x19ab, 0x19b0...0x19c9, 0x19d0...0x19da, 0x1a00...0x1a1b, 0x1a20...0x1a5e, 0x1a60...0x1a7c, 0x1a7f...0x1a89, 0x1a90...0x1a99, 0x1aa7...0x1aa7, 0x1ab0...0x1abd, 0x1abf...0x1ac0, 0x1b00...0x1b4b, 0x1b50...0x1b59, 0x1b6b...0x1b73, 0x1b80...0x1bf3, 0x1c00...0x1c37, 0x1c40...0x1c49, 0x1c4d...0x1c7d, 0x1c80...0x1c88, 0x1c90...0x1cba, 0x1cbd...0x1cbf, 0x1cd0...0x1cd2, 0x1cd4...0x1cfa, 0x1d00...0x1df9, 0x1dfb...0x1f15, 0x1f18...0x1f1d, 0x1f20...0x1f45, 0x1f48...0x1f4d, 0x1f50...0x1f57, 0x1f59...0x1f59, 0x1f5b...0x1f5b, 0x1f5d...0x1f5d, 0x1f5f...0x1f7d, 0x1f80...0x1fb4, 0x1fb6...0x1fbc, 0x1fbe...0x1fbe, 0x1fc2...0x1fc4, 0x1fc6...0x1fcc, 0x1fd0...0x1fd3, 0x1fd6...0x1fdb, 0x1fe0...0x1fec, 0x1ff2...0x1ff4, 0x1ff6...0x1ffc, 0x203f...0x2040, 0x2054...0x2054, 0x2071...0x2071, 0x207f...0x207f, 0x2090...0x209c, 0x20d0...0x20dc, 0x20e1...0x20e1, 0x20e5...0x20f0, 0x2102...0x2102, 0x2107...0x2107, 0x210a...0x2113, 0x2115...0x2115, 0x2118...0x211d, 0x2124...0x2124, 0x2126...0x2126, 0x2128...0x2128, 0x212a...0x2139, 0x213c...0x213f, 0x2145...0x2149, 0x214e...0x214e, 0x2160...0x2188, 0x2c00...0x2c2e, 0x2c30...0x2c5e, 0x2c60...0x2ce4, 0x2ceb...0x2cf3, 0x2d00...0x2d25, 0x2d27...0x2d27, 0x2d2d...0x2d2d, 0x2d30...0x2d67, 0x2d6f...0x2d6f, 0x2d7f...0x2d96, 0x2da0...0x2da6, 0x2da8...0x2dae, 0x2db0...0x2db6, 0x2db8...0x2dbe, 0x2dc0...0x2dc6, 0x2dc8...0x2dce, 0x2dd0...0x2dd6, 0x2dd8...0x2dde, 0x2de0...0x2dff, 0x3005...0x3007, 0x3021...0x302f, 0x3031...0x3035, 0x3038...0x303c, 0x3041...0x3096, 0x3099...0x309f, 0x30a1...0x30ff, 0x3105...0x312f, 0x3131...0x318e, 0x31a0...0x31bf, 0x31f0...0x31ff, 0x3400...0x4dbf, 0x4e00...0x9ffc, 0xa000...0xa48c, 0xa4d0...0xa4fd, 0xa500...0xa60c, 0xa610...0xa62b, 0xa640...0xa66f, 0xa674...0xa67d, 0xa67f...0xa6f1, 0xa717...0xa71f, 0xa722...0xa788, 0xa78b...0xa7bf, 0xa7c2...0xa7ca, 0xa7f5...0xa827, 0xa82c...0xa82c, 0xa840...0xa873, 0xa880...0xa8c5, 0xa8d0...0xa8d9, 0xa8e0...0xa8f7, 0xa8fb...0xa8fb, 0xa8fd...0xa92d, 0xa930...0xa953, 0xa960...0xa97c, 0xa980...0xa9c0, 0xa9cf...0xa9d9, 0xa9e0...0xa9fe, 0xaa00...0xaa36, 0xaa40...0xaa4d, 0xaa50...0xaa59, 0xaa60...0xaa76, 0xaa7a...0xaac2, 0xaadb...0xaadd, 0xaae0...0xaaef, 0xaaf2...0xaaf6, 0xab01...0xab06, 0xab09...0xab0e, 0xab11...0xab16, 0xab20...0xab26, 0xab28...0xab2e, 0xab30...0xab5a, 0xab5c...0xab69, 0xab70...0xabea, 0xabec...0xabed, 0xabf0...0xabf9, 0xac00...0xd7a3, 0xd7b0...0xd7c6, 0xd7cb...0xd7fb, 0xf900...0xfa6d, 0xfa70...0xfad9, 0xfb00...0xfb06, 0xfb13...0xfb17, 0xfb1d...0xfb28, 0xfb2a...0xfb36, 0xfb38...0xfb3c, 0xfb3e...0xfb3e, 0xfb40...0xfb41, 0xfb43...0xfb44, 0xfb46...0xfbb1, 0xfbd3...0xfd3d, 0xfd50...0xfd8f, 0xfd92...0xfdc7, 0xfdf0...0xfdfb, 0xfe00...0xfe0f, 0xfe20...0xfe2f, 0xfe33...0xfe34, 0xfe4d...0xfe4f, 0xfe70...0xfe74, 0xfe76...0xfefc, 0xff10...0xff19, 0xff21...0xff3a, 0xff3f...0xff3f, 0xff41...0xff5a, 0xff65...0xffbe, 0xffc2...0xffc7, 0xffca...0xffcf, 0xffd2...0xffd7 => true,
            else => false,
        };
    }

    fn isIdentifierPartSlow32(codepoint: i32) bool {
        return switch (codepoint) {
            0xffda...0xffdc, 0x10000...0x1000b, 0x1000d...0x10026, 0x10028...0x1003a, 0x1003c...0x1003d, 0x1003f...0x1004d, 0x10050...0x1005d, 0x10080...0x100fa, 0x10140...0x10174, 0x101fd...0x101fd, 0x10280...0x1029c, 0x102a0...0x102d0, 0x102e0...0x102e0, 0x10300...0x1031f, 0x1032d...0x1034a, 0x10350...0x1037a, 0x10380...0x1039d, 0x103a0...0x103c3, 0x103c8...0x103cf, 0x103d1...0x103d5, 0x10400...0x1049d, 0x104a0...0x104a9, 0x104b0...0x104d3, 0x104d8...0x104fb, 0x10500...0x10527, 0x10530...0x10563, 0x10600...0x10736, 0x10740...0x10755, 0x10760...0x10767, 0x10800...0x10805, 0x10808...0x10808, 0x1080a...0x10835, 0x10837...0x10838, 0x1083c...0x1083c, 0x1083f...0x10855, 0x10860...0x10876, 0x10880...0x1089e, 0x108e0...0x108f2, 0x108f4...0x108f5, 0x10900...0x10915, 0x10920...0x10939, 0x10980...0x109b7, 0x109be...0x109bf, 0x10a00...0x10a03, 0x10a05...0x10a06, 0x10a0c...0x10a13, 0x10a15...0x10a17, 0x10a19...0x10a35, 0x10a38...0x10a3a, 0x10a3f...0x10a3f, 0x10a60...0x10a7c, 0x10a80...0x10a9c, 0x10ac0...0x10ac7, 0x10ac9...0x10ae6, 0x10b00...0x10b35, 0x10b40...0x10b55, 0x10b60...0x10b72, 0x10b80...0x10b91, 0x10c00...0x10c48, 0x10c80...0x10cb2, 0x10cc0...0x10cf2, 0x10d00...0x10d27, 0x10d30...0x10d39, 0x10e80...0x10ea9, 0x10eab...0x10eac, 0x10eb0...0x10eb1, 0x10f00...0x10f1c, 0x10f27...0x10f27, 0x10f30...0x10f50, 0x10fb0...0x10fc4, 0x10fe0...0x10ff6, 0x11000...0x11046, 0x11066...0x1106f, 0x1107f...0x110ba, 0x110d0...0x110e8, 0x110f0...0x110f9, 0x11100...0x11134, 0x11136...0x1113f, 0x11144...0x11147, 0x11150...0x11173, 0x11176...0x11176, 0x11180...0x111c4, 0x111c9...0x111cc, 0x111ce...0x111da, 0x111dc...0x111dc, 0x11200...0x11211, 0x11213...0x11237, 0x1123e...0x1123e, 0x11280...0x11286, 0x11288...0x11288, 0x1128a...0x1128d, 0x1128f...0x1129d, 0x1129f...0x112a8, 0x112b0...0x112ea, 0x112f0...0x112f9, 0x11300...0x11303, 0x11305...0x1130c, 0x1130f...0x11310, 0x11313...0x11328, 0x1132a...0x11330, 0x11332...0x11333, 0x11335...0x11339, 0x1133b...0x11344, 0x11347...0x11348, 0x1134b...0x1134d, 0x11350...0x11350, 0x11357...0x11357, 0x1135d...0x11363, 0x11366...0x1136c, 0x11370...0x11374, 0x11400...0x1144a, 0x11450...0x11459, 0x1145e...0x11461, 0x11480...0x114c5, 0x114c7...0x114c7, 0x114d0...0x114d9, 0x11580...0x115b5, 0x115b8...0x115c0, 0x115d8...0x115dd, 0x11600...0x11640, 0x11644...0x11644, 0x11650...0x11659, 0x11680...0x116b8, 0x116c0...0x116c9, 0x11700...0x1171a, 0x1171d...0x1172b, 0x11730...0x11739, 0x11800...0x1183a, 0x118a0...0x118e9, 0x118ff...0x11906, 0x11909...0x11909, 0x1190c...0x11913, 0x11915...0x11916, 0x11918...0x11935, 0x11937...0x11938, 0x1193b...0x11943, 0x11950...0x11959, 0x119a0...0x119a7, 0x119aa...0x119d7, 0x119da...0x119e1, 0x119e3...0x119e4, 0x11a00...0x11a3e, 0x11a47...0x11a47, 0x11a50...0x11a99, 0x11a9d...0x11a9d, 0x11ac0...0x11af8, 0x11c00...0x11c08, 0x11c0a...0x11c36, 0x11c38...0x11c40, 0x11c50...0x11c59, 0x11c72...0x11c8f, 0x11c92...0x11ca7, 0x11ca9...0x11cb6, 0x11d00...0x11d06, 0x11d08...0x11d09, 0x11d0b...0x11d36, 0x11d3a...0x11d3a, 0x11d3c...0x11d3d, 0x11d3f...0x11d47, 0x11d50...0x11d59, 0x11d60...0x11d65, 0x11d67...0x11d68, 0x11d6a...0x11d8e, 0x11d90...0x11d91, 0x11d93...0x11d98, 0x11da0...0x11da9, 0x11ee0...0x11ef6, 0x11fb0...0x11fb0, 0x12000...0x12399, 0x12400...0x1246e, 0x12480...0x12543, 0x13000...0x1342e, 0x14400...0x14646, 0x16800...0x16a38, 0x16a40...0x16a5e, 0x16a60...0x16a69, 0x16ad0...0x16aed, 0x16af0...0x16af4, 0x16b00...0x16b36, 0x16b40...0x16b43, 0x16b50...0x16b59, 0x16b63...0x16b77, 0x16b7d...0x16b8f, 0x16e40...0x16e7f, 0x16f00...0x16f4a, 0x16f4f...0x16f87, 0x16f8f...0x16f9f, 0x16fe0...0x16fe1, 0x16fe3...0x16fe4, 0x16ff0...0x16ff1, 0x17000...0x187f7, 0x18800...0x18cd5, 0x18d00...0x18d08, 0x1b000...0x1b11e, 0x1b150...0x1b152, 0x1b164...0x1b167, 0x1b170...0x1b2fb, 0x1bc00...0x1bc6a, 0x1bc70...0x1bc7c, 0x1bc80...0x1bc88, 0x1bc90...0x1bc99, 0x1bc9d...0x1bc9e, 0x1d165...0x1d169, 0x1d16d...0x1d172, 0x1d17b...0x1d182, 0x1d185...0x1d18b, 0x1d1aa...0x1d1ad, 0x1d242...0x1d244, 0x1d400...0x1d454, 0x1d456...0x1d49c, 0x1d49e...0x1d49f, 0x1d4a2...0x1d4a2, 0x1d4a5...0x1d4a6, 0x1d4a9...0x1d4ac, 0x1d4ae...0x1d4b9, 0x1d4bb...0x1d4bb, 0x1d4bd...0x1d4c3, 0x1d4c5...0x1d505, 0x1d507...0x1d50a, 0x1d50d...0x1d514, 0x1d516...0x1d51c, 0x1d51e...0x1d539, 0x1d53b...0x1d53e, 0x1d540...0x1d544, 0x1d546...0x1d546, 0x1d54a...0x1d550, 0x1d552...0x1d6a5, 0x1d6a8...0x1d6c0, 0x1d6c2...0x1d6da, 0x1d6dc...0x1d6fa, 0x1d6fc...0x1d714, 0x1d716...0x1d734, 0x1d736...0x1d74e, 0x1d750...0x1d76e, 0x1d770...0x1d788, 0x1d78a...0x1d7a8, 0x1d7aa...0x1d7c2, 0x1d7c4...0x1d7cb, 0x1d7ce...0x1d7ff, 0x1da00...0x1da36, 0x1da3b...0x1da6c, 0x1da75...0x1da75, 0x1da84...0x1da84, 0x1da9b...0x1da9f, 0x1daa1...0x1daaf, 0x1e000...0x1e006, 0x1e008...0x1e018, 0x1e01b...0x1e021, 0x1e023...0x1e024, 0x1e026...0x1e02a, 0x1e100...0x1e12c, 0x1e130...0x1e13d, 0x1e140...0x1e149, 0x1e14e...0x1e14e, 0x1e2c0...0x1e2f9, 0x1e800...0x1e8c4, 0x1e8d0...0x1e8d6, 0x1e900...0x1e94b, 0x1e950...0x1e959, 0x1ee00...0x1ee03, 0x1ee05...0x1ee1f, 0x1ee21...0x1ee22, 0x1ee24...0x1ee24, 0x1ee27...0x1ee27, 0x1ee29...0x1ee32, 0x1ee34...0x1ee37, 0x1ee39...0x1ee39, 0x1ee3b...0x1ee3b, 0x1ee42...0x1ee42, 0x1ee47...0x1ee47, 0x1ee49...0x1ee49, 0x1ee4b...0x1ee4b, 0x1ee4d...0x1ee4f, 0x1ee51...0x1ee52, 0x1ee54...0x1ee54, 0x1ee57...0x1ee57, 0x1ee59...0x1ee59, 0x1ee5b...0x1ee5b, 0x1ee5d...0x1ee5d, 0x1ee5f...0x1ee5f, 0x1ee61...0x1ee62, 0x1ee64...0x1ee64, 0x1ee67...0x1ee6a, 0x1ee6c...0x1ee72, 0x1ee74...0x1ee77, 0x1ee79...0x1ee7c, 0x1ee7e...0x1ee7e, 0x1ee80...0x1ee89, 0x1ee8b...0x1ee9b, 0x1eea1...0x1eea3, 0x1eea5...0x1eea9, 0x1eeab...0x1eebb, 0x1fbf0...0x1fbf9, 0x20000...0x2a6dd, 0x2a700...0x2b734, 0x2b740...0x2b81d, 0x2b820...0x2cea1, 0x2ceb0...0x2ebe0, 0x2f800...0x2fa1d, 0x30000...0x3134a, 0xe0100...0xe01ef => true,
            else => false,
        };
    }

    fn isIdentifierStartSlow16(codepoint: u16) bool {
        return switch (codepoint) {
            0xaa...0xaa, 0xb5...0xb5, 0xba...0xba, 0xc0...0xd6, 0xd8...0xf6, 0xf8...0x2c1, 0x2c6...0x2d1, 0x2e0...0x2e4, 0x2ec...0x2ec, 0x2ee...0x2ee, 0x370...0x374, 0x376...0x377, 0x37a...0x37d, 0x37f...0x37f, 0x386...0x386, 0x388...0x38a, 0x38c...0x38c, 0x38e...0x3a1, 0x3a3...0x3f5, 0x3f7...0x481, 0x48a...0x52f, 0x531...0x556, 0x559...0x559, 0x560...0x588, 0x5d0...0x5ea, 0x5ef...0x5f2, 0x620...0x64a, 0x66e...0x66f, 0x671...0x6d3, 0x6d5...0x6d5, 0x6e5...0x6e6, 0x6ee...0x6ef, 0x6fa...0x6fc, 0x6ff...0x6ff, 0x710...0x710, 0x712...0x72f, 0x74d...0x7a5, 0x7b1...0x7b1, 0x7ca...0x7ea, 0x7f4...0x7f5, 0x7fa...0x7fa, 0x800...0x815, 0x81a...0x81a, 0x824...0x824, 0x828...0x828, 0x840...0x858, 0x860...0x86a, 0x8a0...0x8b4, 0x8b6...0x8c7, 0x904...0x939, 0x93d...0x93d, 0x950...0x950, 0x958...0x961, 0x971...0x980, 0x985...0x98c, 0x98f...0x990, 0x993...0x9a8, 0x9aa...0x9b0, 0x9b2...0x9b2, 0x9b6...0x9b9, 0x9bd...0x9bd, 0x9ce...0x9ce, 0x9dc...0x9dd, 0x9df...0x9e1, 0x9f0...0x9f1, 0x9fc...0x9fc, 0xa05...0xa0a, 0xa0f...0xa10, 0xa13...0xa28, 0xa2a...0xa30, 0xa32...0xa33, 0xa35...0xa36, 0xa38...0xa39, 0xa59...0xa5c, 0xa5e...0xa5e, 0xa72...0xa74, 0xa85...0xa8d, 0xa8f...0xa91, 0xa93...0xaa8, 0xaaa...0xab0, 0xab2...0xab3, 0xab5...0xab9, 0xabd...0xabd, 0xad0...0xad0, 0xae0...0xae1, 0xaf9...0xaf9, 0xb05...0xb0c, 0xb0f...0xb10, 0xb13...0xb28, 0xb2a...0xb30, 0xb32...0xb33, 0xb35...0xb39, 0xb3d...0xb3d, 0xb5c...0xb5d, 0xb5f...0xb61, 0xb71...0xb71, 0xb83...0xb83, 0xb85...0xb8a, 0xb8e...0xb90, 0xb92...0xb95, 0xb99...0xb9a, 0xb9c...0xb9c, 0xb9e...0xb9f, 0xba3...0xba4, 0xba8...0xbaa, 0xbae...0xbb9, 0xbd0...0xbd0, 0xc05...0xc0c, 0xc0e...0xc10, 0xc12...0xc28, 0xc2a...0xc39, 0xc3d...0xc3d, 0xc58...0xc5a, 0xc60...0xc61, 0xc80...0xc80, 0xc85...0xc8c, 0xc8e...0xc90, 0xc92...0xca8, 0xcaa...0xcb3, 0xcb5...0xcb9, 0xcbd...0xcbd, 0xcde...0xcde, 0xce0...0xce1, 0xcf1...0xcf2, 0xd04...0xd0c, 0xd0e...0xd10, 0xd12...0xd3a, 0xd3d...0xd3d, 0xd4e...0xd4e, 0xd54...0xd56, 0xd5f...0xd61, 0xd7a...0xd7f, 0xd85...0xd96, 0xd9a...0xdb1, 0xdb3...0xdbb, 0xdbd...0xdbd, 0xdc0...0xdc6, 0xe01...0xe30, 0xe32...0xe33, 0xe40...0xe46, 0xe81...0xe82, 0xe84...0xe84, 0xe86...0xe8a, 0xe8c...0xea3, 0xea5...0xea5, 0xea7...0xeb0, 0xeb2...0xeb3, 0xebd...0xebd, 0xec0...0xec4, 0xec6...0xec6, 0xedc...0xedf, 0xf00...0xf00, 0xf40...0xf47, 0xf49...0xf6c, 0xf88...0xf8c, 0x1000...0x102a, 0x103f...0x103f, 0x1050...0x1055, 0x105a...0x105d, 0x1061...0x1061, 0x1065...0x1066, 0x106e...0x1070, 0x1075...0x1081, 0x108e...0x108e, 0x10a0...0x10c5, 0x10c7...0x10c7, 0x10cd...0x10cd, 0x10d0...0x10fa, 0x10fc...0x1248, 0x124a...0x124d, 0x1250...0x1256, 0x1258...0x1258, 0x125a...0x125d, 0x1260...0x1288, 0x128a...0x128d, 0x1290...0x12b0, 0x12b2...0x12b5, 0x12b8...0x12be, 0x12c0...0x12c0, 0x12c2...0x12c5, 0x12c8...0x12d6, 0x12d8...0x1310, 0x1312...0x1315, 0x1318...0x135a, 0x1380...0x138f, 0x13a0...0x13f5, 0x13f8...0x13fd, 0x1401...0x166c, 0x166f...0x167f, 0x1681...0x169a, 0x16a0...0x16ea, 0x16ee...0x16f8, 0x1700...0x170c, 0x170e...0x1711, 0x1720...0x1731, 0x1740...0x1751, 0x1760...0x176c, 0x176e...0x1770, 0x1780...0x17b3, 0x17d7...0x17d7, 0x17dc...0x17dc, 0x1820...0x1878, 0x1880...0x18a8, 0x18aa...0x18aa, 0x18b0...0x18f5, 0x1900...0x191e, 0x1950...0x196d, 0x1970...0x1974, 0x1980...0x19ab, 0x19b0...0x19c9, 0x1a00...0x1a16, 0x1a20...0x1a54, 0x1aa7...0x1aa7, 0x1b05...0x1b33, 0x1b45...0x1b4b, 0x1b83...0x1ba0, 0x1bae...0x1baf, 0x1bba...0x1be5, 0x1c00...0x1c23, 0x1c4d...0x1c4f, 0x1c5a...0x1c7d, 0x1c80...0x1c88, 0x1c90...0x1cba, 0x1cbd...0x1cbf, 0x1ce9...0x1cec, 0x1cee...0x1cf3, 0x1cf5...0x1cf6, 0x1cfa...0x1cfa, 0x1d00...0x1dbf, 0x1e00...0x1f15, 0x1f18...0x1f1d, 0x1f20...0x1f45, 0x1f48...0x1f4d, 0x1f50...0x1f57, 0x1f59...0x1f59, 0x1f5b...0x1f5b, 0x1f5d...0x1f5d, 0x1f5f...0x1f7d, 0x1f80...0x1fb4, 0x1fb6...0x1fbc, 0x1fbe...0x1fbe, 0x1fc2...0x1fc4, 0x1fc6...0x1fcc, 0x1fd0...0x1fd3, 0x1fd6...0x1fdb, 0x1fe0...0x1fec, 0x1ff2...0x1ff4, 0x1ff6...0x1ffc, 0x2071...0x2071, 0x207f...0x207f, 0x2090...0x209c, 0x2102...0x2102, 0x2107...0x2107, 0x210a...0x2113, 0x2115...0x2115, 0x2118...0x211d, 0x2124...0x2124, 0x2126...0x2126, 0x2128...0x2128, 0x212a...0x2139, 0x213c...0x213f, 0x2145...0x2149, 0x214e...0x214e, 0x2160...0x2188, 0x2c00...0x2c2e, 0x2c30...0x2c5e, 0x2c60...0x2ce4, 0x2ceb...0x2cee, 0x2cf2...0x2cf3, 0x2d00...0x2d25, 0x2d27...0x2d27, 0x2d2d...0x2d2d, 0x2d30...0x2d67, 0x2d6f...0x2d6f, 0x2d80...0x2d96, 0x2da0...0x2da6, 0x2da8...0x2dae, 0x2db0...0x2db6, 0x2db8...0x2dbe, 0x2dc0...0x2dc6, 0x2dc8...0x2dce, 0x2dd0...0x2dd6, 0x2dd8...0x2dde, 0x3005...0x3007, 0x3021...0x3029, 0x3031...0x3035, 0x3038...0x303c, 0x3041...0x3096, 0x309b...0x309f, 0x30a1...0x30fa, 0x30fc...0x30ff, 0x3105...0x312f, 0x3131...0x318e, 0x31a0...0x31bf, 0x31f0...0x31ff, 0x3400...0x4dbf, 0x4e00...0x9ffc, 0xa000...0xa48c, 0xa4d0...0xa4fd, 0xa500...0xa60c, 0xa610...0xa61f, 0xa62a...0xa62b, 0xa640...0xa66e, 0xa67f...0xa69d, 0xa6a0...0xa6ef, 0xa717...0xa71f, 0xa722...0xa788, 0xa78b...0xa7bf, 0xa7c2...0xa7ca, 0xa7f5...0xa801, 0xa803...0xa805, 0xa807...0xa80a, 0xa80c...0xa822, 0xa840...0xa873, 0xa882...0xa8b3, 0xa8f2...0xa8f7, 0xa8fb...0xa8fb, 0xa8fd...0xa8fe, 0xa90a...0xa925, 0xa930...0xa946, 0xa960...0xa97c, 0xa984...0xa9b2, 0xa9cf...0xa9cf, 0xa9e0...0xa9e4, 0xa9e6...0xa9ef, 0xa9fa...0xa9fe, 0xaa00...0xaa28, 0xaa40...0xaa42, 0xaa44...0xaa4b, 0xaa60...0xaa76, 0xaa7a...0xaa7a, 0xaa7e...0xaaaf, 0xaab1...0xaab1, 0xaab5...0xaab6, 0xaab9...0xaabd, 0xaac0...0xaac0, 0xaac2...0xaac2, 0xaadb...0xaadd, 0xaae0...0xaaea, 0xaaf2...0xaaf4, 0xab01...0xab06, 0xab09...0xab0e, 0xab11...0xab16, 0xab20...0xab26, 0xab28...0xab2e, 0xab30...0xab5a, 0xab5c...0xab69, 0xab70...0xabe2, 0xac00...0xd7a3, 0xd7b0...0xd7c6, 0xd7cb...0xd7fb, 0xf900...0xfa6d, 0xfa70...0xfad9, 0xfb00...0xfb06, 0xfb13...0xfb17, 0xfb1d...0xfb1d, 0xfb1f...0xfb28, 0xfb2a...0xfb36, 0xfb38...0xfb3c, 0xfb3e...0xfb3e, 0xfb40...0xfb41, 0xfb43...0xfb44, 0xfb46...0xfbb1, 0xfbd3...0xfd3d, 0xfd50...0xfd8f, 0xfd92...0xfdc7 => true,
            else => false,
        };
    }

    fn isIdentifierStartSlow32(codepoint: i32) bool {
        return switch (codepoint) {
            0xfdf0...0xfdfb, 0xfe70...0xfe74, 0xfe76...0xfefc, 0xff21...0xff3a, 0xff41...0xff5a, 0xff66...0xffbe, 0xffc2...0xffc7, 0xffca...0xffcf, 0xffd2...0xffd7, 0xffda...0xffdc, 0x10000...0x1000b, 0x1000d...0x10026, 0x10028...0x1003a, 0x1003c...0x1003d, 0x1003f...0x1004d, 0x10050...0x1005d, 0x10080...0x100fa, 0x10140...0x10174, 0x10280...0x1029c, 0x102a0...0x102d0, 0x10300...0x1031f, 0x1032d...0x1034a, 0x10350...0x10375, 0x10380...0x1039d, 0x103a0...0x103c3, 0x103c8...0x103cf, 0x103d1...0x103d5, 0x10400...0x1049d, 0x104b0...0x104d3, 0x104d8...0x104fb, 0x10500...0x10527, 0x10530...0x10563, 0x10600...0x10736, 0x10740...0x10755, 0x10760...0x10767, 0x10800...0x10805, 0x10808...0x10808, 0x1080a...0x10835, 0x10837...0x10838, 0x1083c...0x1083c, 0x1083f...0x10855, 0x10860...0x10876, 0x10880...0x1089e, 0x108e0...0x108f2, 0x108f4...0x108f5, 0x10900...0x10915, 0x10920...0x10939, 0x10980...0x109b7, 0x109be...0x109bf, 0x10a00...0x10a00, 0x10a10...0x10a13, 0x10a15...0x10a17, 0x10a19...0x10a35, 0x10a60...0x10a7c, 0x10a80...0x10a9c, 0x10ac0...0x10ac7, 0x10ac9...0x10ae4, 0x10b00...0x10b35, 0x10b40...0x10b55, 0x10b60...0x10b72, 0x10b80...0x10b91, 0x10c00...0x10c48, 0x10c80...0x10cb2, 0x10cc0...0x10cf2, 0x10d00...0x10d23, 0x10e80...0x10ea9, 0x10eb0...0x10eb1, 0x10f00...0x10f1c, 0x10f27...0x10f27, 0x10f30...0x10f45, 0x10fb0...0x10fc4, 0x10fe0...0x10ff6, 0x11003...0x11037, 0x11083...0x110af, 0x110d0...0x110e8, 0x11103...0x11126, 0x11144...0x11144, 0x11147...0x11147, 0x11150...0x11172, 0x11176...0x11176, 0x11183...0x111b2, 0x111c1...0x111c4, 0x111da...0x111da, 0x111dc...0x111dc, 0x11200...0x11211, 0x11213...0x1122b, 0x11280...0x11286, 0x11288...0x11288, 0x1128a...0x1128d, 0x1128f...0x1129d, 0x1129f...0x112a8, 0x112b0...0x112de, 0x11305...0x1130c, 0x1130f...0x11310, 0x11313...0x11328, 0x1132a...0x11330, 0x11332...0x11333, 0x11335...0x11339, 0x1133d...0x1133d, 0x11350...0x11350, 0x1135d...0x11361, 0x11400...0x11434, 0x11447...0x1144a, 0x1145f...0x11461, 0x11480...0x114af, 0x114c4...0x114c5, 0x114c7...0x114c7, 0x11580...0x115ae, 0x115d8...0x115db, 0x11600...0x1162f, 0x11644...0x11644, 0x11680...0x116aa, 0x116b8...0x116b8, 0x11700...0x1171a, 0x11800...0x1182b, 0x118a0...0x118df, 0x118ff...0x11906, 0x11909...0x11909, 0x1190c...0x11913, 0x11915...0x11916, 0x11918...0x1192f, 0x1193f...0x1193f, 0x11941...0x11941, 0x119a0...0x119a7, 0x119aa...0x119d0, 0x119e1...0x119e1, 0x119e3...0x119e3, 0x11a00...0x11a00, 0x11a0b...0x11a32, 0x11a3a...0x11a3a, 0x11a50...0x11a50, 0x11a5c...0x11a89, 0x11a9d...0x11a9d, 0x11ac0...0x11af8, 0x11c00...0x11c08, 0x11c0a...0x11c2e, 0x11c40...0x11c40, 0x11c72...0x11c8f, 0x11d00...0x11d06, 0x11d08...0x11d09, 0x11d0b...0x11d30, 0x11d46...0x11d46, 0x11d60...0x11d65, 0x11d67...0x11d68, 0x11d6a...0x11d89, 0x11d98...0x11d98, 0x11ee0...0x11ef2, 0x11fb0...0x11fb0, 0x12000...0x12399, 0x12400...0x1246e, 0x12480...0x12543, 0x13000...0x1342e, 0x14400...0x14646, 0x16800...0x16a38, 0x16a40...0x16a5e, 0x16ad0...0x16aed, 0x16b00...0x16b2f, 0x16b40...0x16b43, 0x16b63...0x16b77, 0x16b7d...0x16b8f, 0x16e40...0x16e7f, 0x16f00...0x16f4a, 0x16f50...0x16f50, 0x16f93...0x16f9f, 0x16fe0...0x16fe1, 0x16fe3...0x16fe3, 0x17000...0x187f7, 0x18800...0x18cd5, 0x18d00...0x18d08, 0x1b000...0x1b11e, 0x1b150...0x1b152, 0x1b164...0x1b167, 0x1b170...0x1b2fb, 0x1bc00...0x1bc6a, 0x1bc70...0x1bc7c, 0x1bc80...0x1bc88, 0x1bc90...0x1bc99, 0x1d400...0x1d454, 0x1d456...0x1d49c, 0x1d49e...0x1d49f, 0x1d4a2...0x1d4a2, 0x1d4a5...0x1d4a6, 0x1d4a9...0x1d4ac, 0x1d4ae...0x1d4b9, 0x1d4bb...0x1d4bb, 0x1d4bd...0x1d4c3, 0x1d4c5...0x1d505, 0x1d507...0x1d50a, 0x1d50d...0x1d514, 0x1d516...0x1d51c, 0x1d51e...0x1d539, 0x1d53b...0x1d53e, 0x1d540...0x1d544, 0x1d546...0x1d546, 0x1d54a...0x1d550, 0x1d552...0x1d6a5, 0x1d6a8...0x1d6c0, 0x1d6c2...0x1d6da, 0x1d6dc...0x1d6fa, 0x1d6fc...0x1d714, 0x1d716...0x1d734, 0x1d736...0x1d74e, 0x1d750...0x1d76e, 0x1d770...0x1d788, 0x1d78a...0x1d7a8, 0x1d7aa...0x1d7c2, 0x1d7c4...0x1d7cb, 0x1e100...0x1e12c, 0x1e137...0x1e13d, 0x1e14e...0x1e14e, 0x1e2c0...0x1e2eb, 0x1e800...0x1e8c4, 0x1e900...0x1e943, 0x1e94b...0x1e94b, 0x1ee00...0x1ee03, 0x1ee05...0x1ee1f, 0x1ee21...0x1ee22, 0x1ee24...0x1ee24, 0x1ee27...0x1ee27, 0x1ee29...0x1ee32, 0x1ee34...0x1ee37, 0x1ee39...0x1ee39, 0x1ee3b...0x1ee3b, 0x1ee42...0x1ee42, 0x1ee47...0x1ee47, 0x1ee49...0x1ee49, 0x1ee4b...0x1ee4b, 0x1ee4d...0x1ee4f, 0x1ee51...0x1ee52, 0x1ee54...0x1ee54, 0x1ee57...0x1ee57, 0x1ee59...0x1ee59, 0x1ee5b...0x1ee5b, 0x1ee5d...0x1ee5d, 0x1ee5f...0x1ee5f, 0x1ee61...0x1ee62, 0x1ee64...0x1ee64, 0x1ee67...0x1ee6a, 0x1ee6c...0x1ee72, 0x1ee74...0x1ee77, 0x1ee79...0x1ee7c, 0x1ee7e...0x1ee7e, 0x1ee80...0x1ee89, 0x1ee8b...0x1ee9b, 0x1eea1...0x1eea3, 0x1eea5...0x1eea9, 0x1eeab...0x1eebb, 0x20000...0x2a6dd, 0x2a700...0x2b734, 0x2b740...0x2b81d, 0x2b820...0x2cea1, 0x2ceb0...0x2ebe0, 0x2f800...0x2fa1d, 0x30000...0x3134a => true,
            else => false,
        };
    }

    noinline fn isIdentifierStartSlow(codepoint: i32) bool {
        @setCold(true);
        return switch (codepoint) {
            // explicitly tell LLVM's optimizer about values we know will not be in the range of this switch statement

            (max_codepoint + 1)...maxInt(i32), minInt(i32)...127 => unreachable,
            128...0xfdc7 => isIdentifierStartSlow16(@as(u16, @intCast(codepoint))),
            0xfdf0...0x3134a => isIdentifierStartSlow32(codepoint),
            else => false,
        };
    }

    pub inline fn isIdentifierStart(codepoint: i32) bool {
        return switch (codepoint) {
            'A'...'Z', 'a'...'z', '$', '_' => true,
            else => if (codepoint < 128)
                return false
            else
                return isIdentifierStartSlow(codepoint),
        };
    }

    pub inline fn isIdentifierPart(codepoint: i32) bool {
        return switch (codepoint) {
            'A'...'Z', 'a'...'z', '0'...'9', '$', '_' => true,
            else => if (codepoint < 128)
                return false
            else if (codepoint == 0x200C or codepoint == 0x200D)
                return true
            else
                return isIdentifierPartSlow(codepoint),
        };
    }
};

pub const JumpTableInline = struct {
    pub inline fn isIdentifierStart(codepoint: i32) bool {
        return switch (codepoint) {
            'A'...'Z', 'a'...'z', '$', '_' => true,

            else => switch (codepoint) {
                0x41...0x5a, 0x61...0x7a, 0xaa...0xaa, 0xb5...0xb5, 0xba...0xba, 0xc0...0xd6, 0xd8...0xf6, 0xf8...0x2c1, 0x2c6...0x2d1, 0x2e0...0x2e4, 0x2ec...0x2ec, 0x2ee...0x2ee, 0x370...0x374, 0x376...0x377, 0x37a...0x37d, 0x37f...0x37f, 0x386...0x386, 0x388...0x38a, 0x38c...0x38c, 0x38e...0x3a1, 0x3a3...0x3f5, 0x3f7...0x481, 0x48a...0x52f, 0x531...0x556, 0x559...0x559, 0x560...0x588, 0x5d0...0x5ea, 0x5ef...0x5f2, 0x620...0x64a, 0x66e...0x66f, 0x671...0x6d3, 0x6d5...0x6d5, 0x6e5...0x6e6, 0x6ee...0x6ef, 0x6fa...0x6fc, 0x6ff...0x6ff, 0x710...0x710, 0x712...0x72f, 0x74d...0x7a5, 0x7b1...0x7b1, 0x7ca...0x7ea, 0x7f4...0x7f5, 0x7fa...0x7fa, 0x800...0x815, 0x81a...0x81a, 0x824...0x824, 0x828...0x828, 0x840...0x858, 0x860...0x86a, 0x8a0...0x8b4, 0x8b6...0x8c7, 0x904...0x939, 0x93d...0x93d, 0x950...0x950, 0x958...0x961, 0x971...0x980, 0x985...0x98c, 0x98f...0x990, 0x993...0x9a8, 0x9aa...0x9b0, 0x9b2...0x9b2, 0x9b6...0x9b9, 0x9bd...0x9bd, 0x9ce...0x9ce, 0x9dc...0x9dd, 0x9df...0x9e1, 0x9f0...0x9f1, 0x9fc...0x9fc, 0xa05...0xa0a, 0xa0f...0xa10, 0xa13...0xa28, 0xa2a...0xa30, 0xa32...0xa33, 0xa35...0xa36, 0xa38...0xa39, 0xa59...0xa5c, 0xa5e...0xa5e, 0xa72...0xa74, 0xa85...0xa8d, 0xa8f...0xa91, 0xa93...0xaa8, 0xaaa...0xab0, 0xab2...0xab3, 0xab5...0xab9, 0xabd...0xabd, 0xad0...0xad0, 0xae0...0xae1, 0xaf9...0xaf9, 0xb05...0xb0c, 0xb0f...0xb10, 0xb13...0xb28, 0xb2a...0xb30, 0xb32...0xb33, 0xb35...0xb39, 0xb3d...0xb3d, 0xb5c...0xb5d, 0xb5f...0xb61, 0xb71...0xb71, 0xb83...0xb83, 0xb85...0xb8a, 0xb8e...0xb90, 0xb92...0xb95, 0xb99...0xb9a, 0xb9c...0xb9c, 0xb9e...0xb9f, 0xba3...0xba4, 0xba8...0xbaa, 0xbae...0xbb9, 0xbd0...0xbd0, 0xc05...0xc0c, 0xc0e...0xc10, 0xc12...0xc28, 0xc2a...0xc39, 0xc3d...0xc3d, 0xc58...0xc5a, 0xc60...0xc61, 0xc80...0xc80, 0xc85...0xc8c, 0xc8e...0xc90, 0xc92...0xca8, 0xcaa...0xcb3, 0xcb5...0xcb9, 0xcbd...0xcbd, 0xcde...0xcde, 0xce0...0xce1, 0xcf1...0xcf2, 0xd04...0xd0c, 0xd0e...0xd10, 0xd12...0xd3a, 0xd3d...0xd3d, 0xd4e...0xd4e, 0xd54...0xd56, 0xd5f...0xd61, 0xd7a...0xd7f, 0xd85...0xd96, 0xd9a...0xdb1, 0xdb3...0xdbb, 0xdbd...0xdbd, 0xdc0...0xdc6, 0xe01...0xe30, 0xe32...0xe33, 0xe40...0xe46, 0xe81...0xe82, 0xe84...0xe84, 0xe86...0xe8a, 0xe8c...0xea3, 0xea5...0xea5, 0xea7...0xeb0, 0xeb2...0xeb3, 0xebd...0xebd, 0xec0...0xec4, 0xec6...0xec6, 0xedc...0xedf, 0xf00...0xf00, 0xf40...0xf47, 0xf49...0xf6c, 0xf88...0xf8c, 0x1000...0x102a, 0x103f...0x103f, 0x1050...0x1055, 0x105a...0x105d, 0x1061...0x1061, 0x1065...0x1066, 0x106e...0x1070, 0x1075...0x1081, 0x108e...0x108e, 0x10a0...0x10c5, 0x10c7...0x10c7, 0x10cd...0x10cd, 0x10d0...0x10fa, 0x10fc...0x1248, 0x124a...0x124d, 0x1250...0x1256, 0x1258...0x1258, 0x125a...0x125d, 0x1260...0x1288, 0x128a...0x128d, 0x1290...0x12b0, 0x12b2...0x12b5, 0x12b8...0x12be, 0x12c0...0x12c0, 0x12c2...0x12c5, 0x12c8...0x12d6, 0x12d8...0x1310, 0x1312...0x1315, 0x1318...0x135a, 0x1380...0x138f, 0x13a0...0x13f5, 0x13f8...0x13fd, 0x1401...0x166c, 0x166f...0x167f, 0x1681...0x169a, 0x16a0...0x16ea, 0x16ee...0x16f8, 0x1700...0x170c, 0x170e...0x1711, 0x1720...0x1731, 0x1740...0x1751, 0x1760...0x176c, 0x176e...0x1770, 0x1780...0x17b3, 0x17d7...0x17d7, 0x17dc...0x17dc, 0x1820...0x1878, 0x1880...0x18a8, 0x18aa...0x18aa, 0x18b0...0x18f5, 0x1900...0x191e, 0x1950...0x196d, 0x1970...0x1974, 0x1980...0x19ab, 0x19b0...0x19c9, 0x1a00...0x1a16, 0x1a20...0x1a54, 0x1aa7...0x1aa7, 0x1b05...0x1b33, 0x1b45...0x1b4b, 0x1b83...0x1ba0, 0x1bae...0x1baf, 0x1bba...0x1be5, 0x1c00...0x1c23, 0x1c4d...0x1c4f, 0x1c5a...0x1c7d, 0x1c80...0x1c88, 0x1c90...0x1cba, 0x1cbd...0x1cbf, 0x1ce9...0x1cec, 0x1cee...0x1cf3, 0x1cf5...0x1cf6, 0x1cfa...0x1cfa, 0x1d00...0x1dbf, 0x1e00...0x1f15, 0x1f18...0x1f1d, 0x1f20...0x1f45, 0x1f48...0x1f4d, 0x1f50...0x1f57, 0x1f59...0x1f59, 0x1f5b...0x1f5b, 0x1f5d...0x1f5d, 0x1f5f...0x1f7d, 0x1f80...0x1fb4, 0x1fb6...0x1fbc, 0x1fbe...0x1fbe, 0x1fc2...0x1fc4, 0x1fc6...0x1fcc, 0x1fd0...0x1fd3, 0x1fd6...0x1fdb, 0x1fe0...0x1fec, 0x1ff2...0x1ff4, 0x1ff6...0x1ffc, 0x2071...0x2071, 0x207f...0x207f, 0x2090...0x209c, 0x2102...0x2102, 0x2107...0x2107, 0x210a...0x2113, 0x2115...0x2115, 0x2118...0x211d, 0x2124...0x2124, 0x2126...0x2126, 0x2128...0x2128, 0x212a...0x2139, 0x213c...0x213f, 0x2145...0x2149, 0x214e...0x214e, 0x2160...0x2188, 0x2c00...0x2c2e, 0x2c30...0x2c5e, 0x2c60...0x2ce4, 0x2ceb...0x2cee, 0x2cf2...0x2cf3, 0x2d00...0x2d25, 0x2d27...0x2d27, 0x2d2d...0x2d2d, 0x2d30...0x2d67, 0x2d6f...0x2d6f, 0x2d80...0x2d96, 0x2da0...0x2da6, 0x2da8...0x2dae, 0x2db0...0x2db6, 0x2db8...0x2dbe, 0x2dc0...0x2dc6, 0x2dc8...0x2dce, 0x2dd0...0x2dd6, 0x2dd8...0x2dde, 0x3005...0x3007, 0x3021...0x3029, 0x3031...0x3035, 0x3038...0x303c, 0x3041...0x3096, 0x309b...0x309f, 0x30a1...0x30fa, 0x30fc...0x30ff, 0x3105...0x312f, 0x3131...0x318e, 0x31a0...0x31bf, 0x31f0...0x31ff, 0x3400...0x4dbf, 0x4e00...0x9ffc, 0xa000...0xa48c, 0xa4d0...0xa4fd, 0xa500...0xa60c, 0xa610...0xa61f, 0xa62a...0xa62b, 0xa640...0xa66e, 0xa67f...0xa69d, 0xa6a0...0xa6ef, 0xa717...0xa71f, 0xa722...0xa788, 0xa78b...0xa7bf, 0xa7c2...0xa7ca, 0xa7f5...0xa801, 0xa803...0xa805, 0xa807...0xa80a, 0xa80c...0xa822, 0xa840...0xa873, 0xa882...0xa8b3, 0xa8f2...0xa8f7, 0xa8fb...0xa8fb, 0xa8fd...0xa8fe, 0xa90a...0xa925, 0xa930...0xa946, 0xa960...0xa97c, 0xa984...0xa9b2, 0xa9cf...0xa9cf, 0xa9e0...0xa9e4, 0xa9e6...0xa9ef, 0xa9fa...0xa9fe, 0xaa00...0xaa28, 0xaa40...0xaa42, 0xaa44...0xaa4b, 0xaa60...0xaa76, 0xaa7a...0xaa7a, 0xaa7e...0xaaaf, 0xaab1...0xaab1, 0xaab5...0xaab6, 0xaab9...0xaabd, 0xaac0...0xaac0, 0xaac2...0xaac2, 0xaadb...0xaadd, 0xaae0...0xaaea, 0xaaf2...0xaaf4, 0xab01...0xab06, 0xab09...0xab0e, 0xab11...0xab16, 0xab20...0xab26, 0xab28...0xab2e, 0xab30...0xab5a, 0xab5c...0xab69, 0xab70...0xabe2, 0xac00...0xd7a3, 0xd7b0...0xd7c6, 0xd7cb...0xd7fb, 0xf900...0xfa6d, 0xfa70...0xfad9, 0xfb00...0xfb06, 0xfb13...0xfb17, 0xfb1d...0xfb1d, 0xfb1f...0xfb28, 0xfb2a...0xfb36, 0xfb38...0xfb3c, 0xfb3e...0xfb3e, 0xfb40...0xfb41, 0xfb43...0xfb44, 0xfb46...0xfbb1, 0xfbd3...0xfd3d, 0xfd50...0xfd8f, 0xfd92...0xfdc7, 0xfdf0...0xfdfb, 0xfe70...0xfe74, 0xfe76...0xfefc, 0xff21...0xff3a, 0xff41...0xff5a, 0xff66...0xffbe, 0xffc2...0xffc7, 0xffca...0xffcf, 0xffd2...0xffd7, 0xffda...0xffdc, 0x10000...0x1000b, 0x1000d...0x10026, 0x10028...0x1003a, 0x1003c...0x1003d, 0x1003f...0x1004d, 0x10050...0x1005d, 0x10080...0x100fa, 0x10140...0x10174, 0x10280...0x1029c, 0x102a0...0x102d0, 0x10300...0x1031f, 0x1032d...0x1034a, 0x10350...0x10375, 0x10380...0x1039d, 0x103a0...0x103c3, 0x103c8...0x103cf, 0x103d1...0x103d5, 0x10400...0x1049d, 0x104b0...0x104d3, 0x104d8...0x104fb, 0x10500...0x10527, 0x10530...0x10563, 0x10600...0x10736, 0x10740...0x10755, 0x10760...0x10767, 0x10800...0x10805, 0x10808...0x10808, 0x1080a...0x10835, 0x10837...0x10838, 0x1083c...0x1083c, 0x1083f...0x10855, 0x10860...0x10876, 0x10880...0x1089e, 0x108e0...0x108f2, 0x108f4...0x108f5, 0x10900...0x10915, 0x10920...0x10939, 0x10980...0x109b7, 0x109be...0x109bf, 0x10a00...0x10a00, 0x10a10...0x10a13, 0x10a15...0x10a17, 0x10a19...0x10a35, 0x10a60...0x10a7c, 0x10a80...0x10a9c, 0x10ac0...0x10ac7, 0x10ac9...0x10ae4, 0x10b00...0x10b35, 0x10b40...0x10b55, 0x10b60...0x10b72, 0x10b80...0x10b91, 0x10c00...0x10c48, 0x10c80...0x10cb2, 0x10cc0...0x10cf2, 0x10d00...0x10d23, 0x10e80...0x10ea9, 0x10eb0...0x10eb1, 0x10f00...0x10f1c, 0x10f27...0x10f27, 0x10f30...0x10f45, 0x10fb0...0x10fc4, 0x10fe0...0x10ff6, 0x11003...0x11037, 0x11083...0x110af, 0x110d0...0x110e8, 0x11103...0x11126, 0x11144...0x11144, 0x11147...0x11147, 0x11150...0x11172, 0x11176...0x11176, 0x11183...0x111b2, 0x111c1...0x111c4, 0x111da...0x111da, 0x111dc...0x111dc, 0x11200...0x11211, 0x11213...0x1122b, 0x11280...0x11286, 0x11288...0x11288, 0x1128a...0x1128d, 0x1128f...0x1129d, 0x1129f...0x112a8, 0x112b0...0x112de, 0x11305...0x1130c, 0x1130f...0x11310, 0x11313...0x11328, 0x1132a...0x11330, 0x11332...0x11333, 0x11335...0x11339, 0x1133d...0x1133d, 0x11350...0x11350, 0x1135d...0x11361, 0x11400...0x11434, 0x11447...0x1144a, 0x1145f...0x11461, 0x11480...0x114af, 0x114c4...0x114c5, 0x114c7...0x114c7, 0x11580...0x115ae, 0x115d8...0x115db, 0x11600...0x1162f, 0x11644...0x11644, 0x11680...0x116aa, 0x116b8...0x116b8, 0x11700...0x1171a, 0x11800...0x1182b, 0x118a0...0x118df, 0x118ff...0x11906, 0x11909...0x11909, 0x1190c...0x11913, 0x11915...0x11916, 0x11918...0x1192f, 0x1193f...0x1193f, 0x11941...0x11941, 0x119a0...0x119a7, 0x119aa...0x119d0, 0x119e1...0x119e1, 0x119e3...0x119e3, 0x11a00...0x11a00, 0x11a0b...0x11a32, 0x11a3a...0x11a3a, 0x11a50...0x11a50, 0x11a5c...0x11a89, 0x11a9d...0x11a9d, 0x11ac0...0x11af8, 0x11c00...0x11c08, 0x11c0a...0x11c2e, 0x11c40...0x11c40, 0x11c72...0x11c8f, 0x11d00...0x11d06, 0x11d08...0x11d09, 0x11d0b...0x11d30, 0x11d46...0x11d46, 0x11d60...0x11d65, 0x11d67...0x11d68, 0x11d6a...0x11d89, 0x11d98...0x11d98, 0x11ee0...0x11ef2, 0x11fb0...0x11fb0, 0x12000...0x12399, 0x12400...0x1246e, 0x12480...0x12543, 0x13000...0x1342e, 0x14400...0x14646, 0x16800...0x16a38, 0x16a40...0x16a5e, 0x16ad0...0x16aed, 0x16b00...0x16b2f, 0x16b40...0x16b43, 0x16b63...0x16b77, 0x16b7d...0x16b8f, 0x16e40...0x16e7f, 0x16f00...0x16f4a, 0x16f50...0x16f50, 0x16f93...0x16f9f, 0x16fe0...0x16fe1, 0x16fe3...0x16fe3, 0x17000...0x187f7, 0x18800...0x18cd5, 0x18d00...0x18d08, 0x1b000...0x1b11e, 0x1b150...0x1b152, 0x1b164...0x1b167, 0x1b170...0x1b2fb, 0x1bc00...0x1bc6a, 0x1bc70...0x1bc7c, 0x1bc80...0x1bc88, 0x1bc90...0x1bc99, 0x1d400...0x1d454, 0x1d456...0x1d49c, 0x1d49e...0x1d49f, 0x1d4a2...0x1d4a2, 0x1d4a5...0x1d4a6, 0x1d4a9...0x1d4ac, 0x1d4ae...0x1d4b9, 0x1d4bb...0x1d4bb, 0x1d4bd...0x1d4c3, 0x1d4c5...0x1d505, 0x1d507...0x1d50a, 0x1d50d...0x1d514, 0x1d516...0x1d51c, 0x1d51e...0x1d539, 0x1d53b...0x1d53e, 0x1d540...0x1d544, 0x1d546...0x1d546, 0x1d54a...0x1d550, 0x1d552...0x1d6a5, 0x1d6a8...0x1d6c0, 0x1d6c2...0x1d6da, 0x1d6dc...0x1d6fa, 0x1d6fc...0x1d714, 0x1d716...0x1d734, 0x1d736...0x1d74e, 0x1d750...0x1d76e, 0x1d770...0x1d788, 0x1d78a...0x1d7a8, 0x1d7aa...0x1d7c2, 0x1d7c4...0x1d7cb, 0x1e100...0x1e12c, 0x1e137...0x1e13d, 0x1e14e...0x1e14e, 0x1e2c0...0x1e2eb, 0x1e800...0x1e8c4, 0x1e900...0x1e943, 0x1e94b...0x1e94b, 0x1ee00...0x1ee03, 0x1ee05...0x1ee1f, 0x1ee21...0x1ee22, 0x1ee24...0x1ee24, 0x1ee27...0x1ee27, 0x1ee29...0x1ee32, 0x1ee34...0x1ee37, 0x1ee39...0x1ee39, 0x1ee3b...0x1ee3b, 0x1ee42...0x1ee42, 0x1ee47...0x1ee47, 0x1ee49...0x1ee49, 0x1ee4b...0x1ee4b, 0x1ee4d...0x1ee4f, 0x1ee51...0x1ee52, 0x1ee54...0x1ee54, 0x1ee57...0x1ee57, 0x1ee59...0x1ee59, 0x1ee5b...0x1ee5b, 0x1ee5d...0x1ee5d, 0x1ee5f...0x1ee5f, 0x1ee61...0x1ee62, 0x1ee64...0x1ee64, 0x1ee67...0x1ee6a, 0x1ee6c...0x1ee72, 0x1ee74...0x1ee77, 0x1ee79...0x1ee7c, 0x1ee7e...0x1ee7e, 0x1ee80...0x1ee89, 0x1ee8b...0x1ee9b, 0x1eea1...0x1eea3, 0x1eea5...0x1eea9, 0x1eeab...0x1eebb, 0x20000...0x2a6dd, 0x2a700...0x2b734, 0x2b740...0x2b81d, 0x2b820...0x2cea1, 0x2ceb0...0x2ebe0, 0x2f800...0x2fa1d, 0x30000...0x3134a => true,
                else => false,
            },
        };
    }

    pub inline fn isIdentifierPart(codepoint: i32) bool {
        return switch (codepoint) {
            'A'...'Z', 'a'...'z', '0'...'9', '$', '_' => true,
            else => switch (codepoint) {
                0x30...0x39, 0x41...0x5a, 0x5f...0x5f, 0x61...0x7a, 0xaa...0xaa, 0xb5...0xb5, 0xb7...0xb7, 0xba...0xba, 0xc0...0xd6, 0xd8...0xf6, 0xf8...0x2c1, 0x2c6...0x2d1, 0x2e0...0x2e4, 0x2ec...0x2ec, 0x2ee...0x2ee, 0x300...0x374, 0x376...0x377, 0x37a...0x37d, 0x37f...0x37f, 0x386...0x38a, 0x38c...0x38c, 0x38e...0x3a1, 0x3a3...0x3f5, 0x3f7...0x481, 0x483...0x487, 0x48a...0x52f, 0x531...0x556, 0x559...0x559, 0x560...0x588, 0x591...0x5bd, 0x5bf...0x5bf, 0x5c1...0x5c2, 0x5c4...0x5c5, 0x5c7...0x5c7, 0x5d0...0x5ea, 0x5ef...0x5f2, 0x610...0x61a, 0x620...0x669, 0x66e...0x6d3, 0x6d5...0x6dc, 0x6df...0x6e8, 0x6ea...0x6fc, 0x6ff...0x6ff, 0x710...0x74a, 0x74d...0x7b1, 0x7c0...0x7f5, 0x7fa...0x7fa, 0x7fd...0x7fd, 0x800...0x82d, 0x840...0x85b, 0x860...0x86a, 0x8a0...0x8b4, 0x8b6...0x8c7, 0x8d3...0x8e1, 0x8e3...0x963, 0x966...0x96f, 0x971...0x983, 0x985...0x98c, 0x98f...0x990, 0x993...0x9a8, 0x9aa...0x9b0, 0x9b2...0x9b2, 0x9b6...0x9b9, 0x9bc...0x9c4, 0x9c7...0x9c8, 0x9cb...0x9ce, 0x9d7...0x9d7, 0x9dc...0x9dd, 0x9df...0x9e3, 0x9e6...0x9f1, 0x9fc...0x9fc, 0x9fe...0x9fe, 0xa01...0xa03, 0xa05...0xa0a, 0xa0f...0xa10, 0xa13...0xa28, 0xa2a...0xa30, 0xa32...0xa33, 0xa35...0xa36, 0xa38...0xa39, 0xa3c...0xa3c, 0xa3e...0xa42, 0xa47...0xa48, 0xa4b...0xa4d, 0xa51...0xa51, 0xa59...0xa5c, 0xa5e...0xa5e, 0xa66...0xa75, 0xa81...0xa83, 0xa85...0xa8d, 0xa8f...0xa91, 0xa93...0xaa8, 0xaaa...0xab0, 0xab2...0xab3, 0xab5...0xab9, 0xabc...0xac5, 0xac7...0xac9, 0xacb...0xacd, 0xad0...0xad0, 0xae0...0xae3, 0xae6...0xaef, 0xaf9...0xaff, 0xb01...0xb03, 0xb05...0xb0c, 0xb0f...0xb10, 0xb13...0xb28, 0xb2a...0xb30, 0xb32...0xb33, 0xb35...0xb39, 0xb3c...0xb44, 0xb47...0xb48, 0xb4b...0xb4d, 0xb55...0xb57, 0xb5c...0xb5d, 0xb5f...0xb63, 0xb66...0xb6f, 0xb71...0xb71, 0xb82...0xb83, 0xb85...0xb8a, 0xb8e...0xb90, 0xb92...0xb95, 0xb99...0xb9a, 0xb9c...0xb9c, 0xb9e...0xb9f, 0xba3...0xba4, 0xba8...0xbaa, 0xbae...0xbb9, 0xbbe...0xbc2, 0xbc6...0xbc8, 0xbca...0xbcd, 0xbd0...0xbd0, 0xbd7...0xbd7, 0xbe6...0xbef, 0xc00...0xc0c, 0xc0e...0xc10, 0xc12...0xc28, 0xc2a...0xc39, 0xc3d...0xc44, 0xc46...0xc48, 0xc4a...0xc4d, 0xc55...0xc56, 0xc58...0xc5a, 0xc60...0xc63, 0xc66...0xc6f, 0xc80...0xc83, 0xc85...0xc8c, 0xc8e...0xc90, 0xc92...0xca8, 0xcaa...0xcb3, 0xcb5...0xcb9, 0xcbc...0xcc4, 0xcc6...0xcc8, 0xcca...0xccd, 0xcd5...0xcd6, 0xcde...0xcde, 0xce0...0xce3, 0xce6...0xcef, 0xcf1...0xcf2, 0xd00...0xd0c, 0xd0e...0xd10, 0xd12...0xd44, 0xd46...0xd48, 0xd4a...0xd4e, 0xd54...0xd57, 0xd5f...0xd63, 0xd66...0xd6f, 0xd7a...0xd7f, 0xd81...0xd83, 0xd85...0xd96, 0xd9a...0xdb1, 0xdb3...0xdbb, 0xdbd...0xdbd, 0xdc0...0xdc6, 0xdca...0xdca, 0xdcf...0xdd4, 0xdd6...0xdd6, 0xdd8...0xddf, 0xde6...0xdef, 0xdf2...0xdf3, 0xe01...0xe3a, 0xe40...0xe4e, 0xe50...0xe59, 0xe81...0xe82, 0xe84...0xe84, 0xe86...0xe8a, 0xe8c...0xea3, 0xea5...0xea5, 0xea7...0xebd, 0xec0...0xec4, 0xec6...0xec6, 0xec8...0xecd, 0xed0...0xed9, 0xedc...0xedf, 0xf00...0xf00, 0xf18...0xf19, 0xf20...0xf29, 0xf35...0xf35, 0xf37...0xf37, 0xf39...0xf39, 0xf3e...0xf47, 0xf49...0xf6c, 0xf71...0xf84, 0xf86...0xf97, 0xf99...0xfbc, 0xfc6...0xfc6, 0x1000...0x1049, 0x1050...0x109d, 0x10a0...0x10c5, 0x10c7...0x10c7, 0x10cd...0x10cd, 0x10d0...0x10fa, 0x10fc...0x1248, 0x124a...0x124d, 0x1250...0x1256, 0x1258...0x1258, 0x125a...0x125d, 0x1260...0x1288, 0x128a...0x128d, 0x1290...0x12b0, 0x12b2...0x12b5, 0x12b8...0x12be, 0x12c0...0x12c0, 0x12c2...0x12c5, 0x12c8...0x12d6, 0x12d8...0x1310, 0x1312...0x1315, 0x1318...0x135a, 0x135d...0x135f, 0x1369...0x1371, 0x1380...0x138f, 0x13a0...0x13f5, 0x13f8...0x13fd, 0x1401...0x166c, 0x166f...0x167f, 0x1681...0x169a, 0x16a0...0x16ea, 0x16ee...0x16f8, 0x1700...0x170c, 0x170e...0x1714, 0x1720...0x1734, 0x1740...0x1753, 0x1760...0x176c, 0x176e...0x1770, 0x1772...0x1773, 0x1780...0x17d3, 0x17d7...0x17d7, 0x17dc...0x17dd, 0x17e0...0x17e9, 0x180b...0x180d, 0x1810...0x1819, 0x1820...0x1878, 0x1880...0x18aa, 0x18b0...0x18f5, 0x1900...0x191e, 0x1920...0x192b, 0x1930...0x193b, 0x1946...0x196d, 0x1970...0x1974, 0x1980...0x19ab, 0x19b0...0x19c9, 0x19d0...0x19da, 0x1a00...0x1a1b, 0x1a20...0x1a5e, 0x1a60...0x1a7c, 0x1a7f...0x1a89, 0x1a90...0x1a99, 0x1aa7...0x1aa7, 0x1ab0...0x1abd, 0x1abf...0x1ac0, 0x1b00...0x1b4b, 0x1b50...0x1b59, 0x1b6b...0x1b73, 0x1b80...0x1bf3, 0x1c00...0x1c37, 0x1c40...0x1c49, 0x1c4d...0x1c7d, 0x1c80...0x1c88, 0x1c90...0x1cba, 0x1cbd...0x1cbf, 0x1cd0...0x1cd2, 0x1cd4...0x1cfa, 0x1d00...0x1df9, 0x1dfb...0x1f15, 0x1f18...0x1f1d, 0x1f20...0x1f45, 0x1f48...0x1f4d, 0x1f50...0x1f57, 0x1f59...0x1f59, 0x1f5b...0x1f5b, 0x1f5d...0x1f5d, 0x1f5f...0x1f7d, 0x1f80...0x1fb4, 0x1fb6...0x1fbc, 0x1fbe...0x1fbe, 0x1fc2...0x1fc4, 0x1fc6...0x1fcc, 0x1fd0...0x1fd3, 0x1fd6...0x1fdb, 0x1fe0...0x1fec, 0x1ff2...0x1ff4, 0x1ff6...0x1ffc, 0x203f...0x2040, 0x2054...0x2054, 0x2071...0x2071, 0x207f...0x207f, 0x2090...0x209c, 0x20d0...0x20dc, 0x20e1...0x20e1, 0x20e5...0x20f0, 0x2102...0x2102, 0x2107...0x2107, 0x210a...0x2113, 0x2115...0x2115, 0x2118...0x211d, 0x2124...0x2124, 0x2126...0x2126, 0x2128...0x2128, 0x212a...0x2139, 0x213c...0x213f, 0x2145...0x2149, 0x214e...0x214e, 0x2160...0x2188, 0x2c00...0x2c2e, 0x2c30...0x2c5e, 0x2c60...0x2ce4, 0x2ceb...0x2cf3, 0x2d00...0x2d25, 0x2d27...0x2d27, 0x2d2d...0x2d2d, 0x2d30...0x2d67, 0x2d6f...0x2d6f, 0x2d7f...0x2d96, 0x2da0...0x2da6, 0x2da8...0x2dae, 0x2db0...0x2db6, 0x2db8...0x2dbe, 0x2dc0...0x2dc6, 0x2dc8...0x2dce, 0x2dd0...0x2dd6, 0x2dd8...0x2dde, 0x2de0...0x2dff, 0x3005...0x3007, 0x3021...0x302f, 0x3031...0x3035, 0x3038...0x303c, 0x3041...0x3096, 0x3099...0x309f, 0x30a1...0x30ff, 0x3105...0x312f, 0x3131...0x318e, 0x31a0...0x31bf, 0x31f0...0x31ff, 0x3400...0x4dbf, 0x4e00...0x9ffc, 0xa000...0xa48c, 0xa4d0...0xa4fd, 0xa500...0xa60c, 0xa610...0xa62b, 0xa640...0xa66f, 0xa674...0xa67d, 0xa67f...0xa6f1, 0xa717...0xa71f, 0xa722...0xa788, 0xa78b...0xa7bf, 0xa7c2...0xa7ca, 0xa7f5...0xa827, 0xa82c...0xa82c, 0xa840...0xa873, 0xa880...0xa8c5, 0xa8d0...0xa8d9, 0xa8e0...0xa8f7, 0xa8fb...0xa8fb, 0xa8fd...0xa92d, 0xa930...0xa953, 0xa960...0xa97c, 0xa980...0xa9c0, 0xa9cf...0xa9d9, 0xa9e0...0xa9fe, 0xaa00...0xaa36, 0xaa40...0xaa4d, 0xaa50...0xaa59, 0xaa60...0xaa76, 0xaa7a...0xaac2, 0xaadb...0xaadd, 0xaae0...0xaaef, 0xaaf2...0xaaf6, 0xab01...0xab06, 0xab09...0xab0e, 0xab11...0xab16, 0xab20...0xab26, 0xab28...0xab2e, 0xab30...0xab5a, 0xab5c...0xab69, 0xab70...0xabea, 0xabec...0xabed, 0xabf0...0xabf9, 0xac00...0xd7a3, 0xd7b0...0xd7c6, 0xd7cb...0xd7fb, 0xf900...0xfa6d, 0xfa70...0xfad9, 0xfb00...0xfb06, 0xfb13...0xfb17, 0xfb1d...0xfb28, 0xfb2a...0xfb36, 0xfb38...0xfb3c, 0xfb3e...0xfb3e, 0xfb40...0xfb41, 0xfb43...0xfb44, 0xfb46...0xfbb1, 0xfbd3...0xfd3d, 0xfd50...0xfd8f, 0xfd92...0xfdc7, 0xfdf0...0xfdfb, 0xfe00...0xfe0f, 0xfe20...0xfe2f, 0xfe33...0xfe34, 0xfe4d...0xfe4f, 0xfe70...0xfe74, 0xfe76...0xfefc, 0xff10...0xff19, 0xff21...0xff3a, 0xff3f...0xff3f, 0xff41...0xff5a, 0xff65...0xffbe, 0xffc2...0xffc7, 0xffca...0xffcf, 0xffd2...0xffd7, 0xffda...0xffdc, 0x10000...0x1000b, 0x1000d...0x10026, 0x10028...0x1003a, 0x1003c...0x1003d, 0x1003f...0x1004d, 0x10050...0x1005d, 0x10080...0x100fa, 0x10140...0x10174, 0x101fd...0x101fd, 0x10280...0x1029c, 0x102a0...0x102d0, 0x102e0...0x102e0, 0x10300...0x1031f, 0x1032d...0x1034a, 0x10350...0x1037a, 0x10380...0x1039d, 0x103a0...0x103c3, 0x103c8...0x103cf, 0x103d1...0x103d5, 0x10400...0x1049d, 0x104a0...0x104a9, 0x104b0...0x104d3, 0x104d8...0x104fb, 0x10500...0x10527, 0x10530...0x10563, 0x10600...0x10736, 0x10740...0x10755, 0x10760...0x10767, 0x10800...0x10805, 0x10808...0x10808, 0x1080a...0x10835, 0x10837...0x10838, 0x1083c...0x1083c, 0x1083f...0x10855, 0x10860...0x10876, 0x10880...0x1089e, 0x108e0...0x108f2, 0x108f4...0x108f5, 0x10900...0x10915, 0x10920...0x10939, 0x10980...0x109b7, 0x109be...0x109bf, 0x10a00...0x10a03, 0x10a05...0x10a06, 0x10a0c...0x10a13, 0x10a15...0x10a17, 0x10a19...0x10a35, 0x10a38...0x10a3a, 0x10a3f...0x10a3f, 0x10a60...0x10a7c, 0x10a80...0x10a9c, 0x10ac0...0x10ac7, 0x10ac9...0x10ae6, 0x10b00...0x10b35, 0x10b40...0x10b55, 0x10b60...0x10b72, 0x10b80...0x10b91, 0x10c00...0x10c48, 0x10c80...0x10cb2, 0x10cc0...0x10cf2, 0x10d00...0x10d27, 0x10d30...0x10d39, 0x10e80...0x10ea9, 0x10eab...0x10eac, 0x10eb0...0x10eb1, 0x10f00...0x10f1c, 0x10f27...0x10f27, 0x10f30...0x10f50, 0x10fb0...0x10fc4, 0x10fe0...0x10ff6, 0x11000...0x11046, 0x11066...0x1106f, 0x1107f...0x110ba, 0x110d0...0x110e8, 0x110f0...0x110f9, 0x11100...0x11134, 0x11136...0x1113f, 0x11144...0x11147, 0x11150...0x11173, 0x11176...0x11176, 0x11180...0x111c4, 0x111c9...0x111cc, 0x111ce...0x111da, 0x111dc...0x111dc, 0x11200...0x11211, 0x11213...0x11237, 0x1123e...0x1123e, 0x11280...0x11286, 0x11288...0x11288, 0x1128a...0x1128d, 0x1128f...0x1129d, 0x1129f...0x112a8, 0x112b0...0x112ea, 0x112f0...0x112f9, 0x11300...0x11303, 0x11305...0x1130c, 0x1130f...0x11310, 0x11313...0x11328, 0x1132a...0x11330, 0x11332...0x11333, 0x11335...0x11339, 0x1133b...0x11344, 0x11347...0x11348, 0x1134b...0x1134d, 0x11350...0x11350, 0x11357...0x11357, 0x1135d...0x11363, 0x11366...0x1136c, 0x11370...0x11374, 0x11400...0x1144a, 0x11450...0x11459, 0x1145e...0x11461, 0x11480...0x114c5, 0x114c7...0x114c7, 0x114d0...0x114d9, 0x11580...0x115b5, 0x115b8...0x115c0, 0x115d8...0x115dd, 0x11600...0x11640, 0x11644...0x11644, 0x11650...0x11659, 0x11680...0x116b8, 0x116c0...0x116c9, 0x11700...0x1171a, 0x1171d...0x1172b, 0x11730...0x11739, 0x11800...0x1183a, 0x118a0...0x118e9, 0x118ff...0x11906, 0x11909...0x11909, 0x1190c...0x11913, 0x11915...0x11916, 0x11918...0x11935, 0x11937...0x11938, 0x1193b...0x11943, 0x11950...0x11959, 0x119a0...0x119a7, 0x119aa...0x119d7, 0x119da...0x119e1, 0x119e3...0x119e4, 0x11a00...0x11a3e, 0x11a47...0x11a47, 0x11a50...0x11a99, 0x11a9d...0x11a9d, 0x11ac0...0x11af8, 0x11c00...0x11c08, 0x11c0a...0x11c36, 0x11c38...0x11c40, 0x11c50...0x11c59, 0x11c72...0x11c8f, 0x11c92...0x11ca7, 0x11ca9...0x11cb6, 0x11d00...0x11d06, 0x11d08...0x11d09, 0x11d0b...0x11d36, 0x11d3a...0x11d3a, 0x11d3c...0x11d3d, 0x11d3f...0x11d47, 0x11d50...0x11d59, 0x11d60...0x11d65, 0x11d67...0x11d68, 0x11d6a...0x11d8e, 0x11d90...0x11d91, 0x11d93...0x11d98, 0x11da0...0x11da9, 0x11ee0...0x11ef6, 0x11fb0...0x11fb0, 0x12000...0x12399, 0x12400...0x1246e, 0x12480...0x12543, 0x13000...0x1342e, 0x14400...0x14646, 0x16800...0x16a38, 0x16a40...0x16a5e, 0x16a60...0x16a69, 0x16ad0...0x16aed, 0x16af0...0x16af4, 0x16b00...0x16b36, 0x16b40...0x16b43, 0x16b50...0x16b59, 0x16b63...0x16b77, 0x16b7d...0x16b8f, 0x16e40...0x16e7f, 0x16f00...0x16f4a, 0x16f4f...0x16f87, 0x16f8f...0x16f9f, 0x16fe0...0x16fe1, 0x16fe3...0x16fe4, 0x16ff0...0x16ff1, 0x17000...0x187f7, 0x18800...0x18cd5, 0x18d00...0x18d08, 0x1b000...0x1b11e, 0x1b150...0x1b152, 0x1b164...0x1b167, 0x1b170...0x1b2fb, 0x1bc00...0x1bc6a, 0x1bc70...0x1bc7c, 0x1bc80...0x1bc88, 0x1bc90...0x1bc99, 0x1bc9d...0x1bc9e, 0x1d165...0x1d169, 0x1d16d...0x1d172, 0x1d17b...0x1d182, 0x1d185...0x1d18b, 0x1d1aa...0x1d1ad, 0x1d242...0x1d244, 0x1d400...0x1d454, 0x1d456...0x1d49c, 0x1d49e...0x1d49f, 0x1d4a2...0x1d4a2, 0x1d4a5...0x1d4a6, 0x1d4a9...0x1d4ac, 0x1d4ae...0x1d4b9, 0x1d4bb...0x1d4bb, 0x1d4bd...0x1d4c3, 0x1d4c5...0x1d505, 0x1d507...0x1d50a, 0x1d50d...0x1d514, 0x1d516...0x1d51c, 0x1d51e...0x1d539, 0x1d53b...0x1d53e, 0x1d540...0x1d544, 0x1d546...0x1d546, 0x1d54a...0x1d550, 0x1d552...0x1d6a5, 0x1d6a8...0x1d6c0, 0x1d6c2...0x1d6da, 0x1d6dc...0x1d6fa, 0x1d6fc...0x1d714, 0x1d716...0x1d734, 0x1d736...0x1d74e, 0x1d750...0x1d76e, 0x1d770...0x1d788, 0x1d78a...0x1d7a8, 0x1d7aa...0x1d7c2, 0x1d7c4...0x1d7cb, 0x1d7ce...0x1d7ff, 0x1da00...0x1da36, 0x1da3b...0x1da6c, 0x1da75...0x1da75, 0x1da84...0x1da84, 0x1da9b...0x1da9f, 0x1daa1...0x1daaf, 0x1e000...0x1e006, 0x1e008...0x1e018, 0x1e01b...0x1e021, 0x1e023...0x1e024, 0x1e026...0x1e02a, 0x1e100...0x1e12c, 0x1e130...0x1e13d, 0x1e140...0x1e149, 0x1e14e...0x1e14e, 0x1e2c0...0x1e2f9, 0x1e800...0x1e8c4, 0x1e8d0...0x1e8d6, 0x1e900...0x1e94b, 0x1e950...0x1e959, 0x1ee00...0x1ee03, 0x1ee05...0x1ee1f, 0x1ee21...0x1ee22, 0x1ee24...0x1ee24, 0x1ee27...0x1ee27, 0x1ee29...0x1ee32, 0x1ee34...0x1ee37, 0x1ee39...0x1ee39, 0x1ee3b...0x1ee3b, 0x1ee42...0x1ee42, 0x1ee47...0x1ee47, 0x1ee49...0x1ee49, 0x1ee4b...0x1ee4b, 0x1ee4d...0x1ee4f, 0x1ee51...0x1ee52, 0x1ee54...0x1ee54, 0x1ee57...0x1ee57, 0x1ee59...0x1ee59, 0x1ee5b...0x1ee5b, 0x1ee5d...0x1ee5d, 0x1ee5f...0x1ee5f, 0x1ee61...0x1ee62, 0x1ee64...0x1ee64, 0x1ee67...0x1ee6a, 0x1ee6c...0x1ee72, 0x1ee74...0x1ee77, 0x1ee79...0x1ee7c, 0x1ee7e...0x1ee7e, 0x1ee80...0x1ee89, 0x1ee8b...0x1ee9b, 0x1eea1...0x1eea3, 0x1eea5...0x1eea9, 0x1eeab...0x1eebb, 0x1fbf0...0x1fbf9, 0x20000...0x2a6dd, 0x2a700...0x2b734, 0x2b740...0x2b81d, 0x2b820...0x2cea1, 0x2ceb0...0x2ebe0, 0x2f800...0x2fa1d, 0x30000...0x3134a, 0xe0100...0xe01ef => true,
                else => false,
            },
        };
    }
};

// // ----- The benchmark ------

// const std = @import("std");

// const part_codepoints_slice: []const i32 = &start_codepoints;
// const start_codepoints_slice: []const i32 = &part_codepoints;

// pub const HashTable = struct {
//     var starts: std.AutoHashMap(i32, void) = undefined;
//     var parts: std.AutoHashMap(i32, void) = undefined;

//     pub fn isIdentifierStart(codepoint: i32) bool {
//         if (codepoint > 255) return starts.contains(codepoint);
//         return switch (codepoint) {
//             'A'...'Z', 'a'...'z', '$', '_' => true,
//             else => false,
//         };
//     }

//     pub fn isIdentifierPart(codepoint: i32) bool {
//         if (codepoint > 255) return parts.contains(codepoint);
//         return switch (codepoint) {
//             'A'...'Z', 'a'...'z', '0'...'9', '$', '_' => true,
//             else => false,
//         };
//     }

//     pub fn init(allocator: std.mem.Allocator) !void {
//         starts = std.AutoHashMap(i32, void).init(allocator);
//         parts = std.AutoHashMap(i32, void).init(allocator);

//         var i: i32 = 0;
//         var j: i32 = 0;

//         while (i < start_codepoints.len) : (i += 2) {
//             j = start_codepoints[i];
//             while (j <= start_codepoints[i + 1]) : (j += 1) {
//                 try starts.put(j, {});
//             }
//         }
//         i = 0;
//         while (i < part_codepoints.len) : (i += 2) {
//             j = part_codepoints[i];
//             while (j <= part_codepoints[i + 1]) : (j += 1) {
//                 try parts.put(j, {});
//             }
//         }
//     }
// };

// pub const BinarySearch = struct {

//     // "lookupInUnicodeMap" in TypeScript
//     // esbuild does something similar
//     fn search(comptime map: []const i32, code: i32) bool {
//         // Bail out quickly if it couldn't possibly be in the map.
//         if (code < map[0]) {
//             return false;
//         }

//         // Perform binary search in one of the Unicode range maps
//         var lo: i32 = 0;
//         var hi: i32 = map.len;
//         var mid: i32 = undefined;

//         while (lo + 1 < hi) {
//             mid = lo + (hi - lo) / 2;
//             // mid has to be even to catch a range's beginning
//             mid -= mid % 2;
//             if (map[mid] <= code and code <= map[mid + 1]) {
//                 return true;
//             }
//             if (code < map[mid]) {
//                 hi = mid;
//             } else {
//                 lo = mid + 2;
//             }
//         }

//         return false;
//     }

//     // https://source.chromium.org/chromium/v8/v8.git/+/master:src/strings/char-predicates-inl.h;l=133
//     pub fn isIdentifierStart(codepoint: i32) bool {
//         if (codepoint > 255) return search(start_codepoints_slice, codepoint);
//         return switch (codepoint) {
//             'A'...'Z', 'a'...'z', '$', '_' => true,
//             else => false,
//         };
//     }

//     pub fn isIdentifierPart(codepoint: i32) bool {
//         if (codepoint > 255) return search(part_codepoints_slice, codepoint);
//         return switch (codepoint) {
//             'A'...'Z', 'a'...'z', '0'...'9', '$', '_' => true,
//             else => false,
//         };
//     }
// };

// const unicode_text: []const u8 =
//     \\
//     \\_a["" + "constructor"] = 133 /* ConstructorKeyword */,
//     \\_a.debugger = 87 /* DebuggerKeyword */,
//     \\_a.declare = 134 /* DeclareKeyword */,
//     \\_a.default = 88 /* DefaultKeyword */,
//     \\_a.delete = 89 /* DeleteKeyword */,
//     \\_a.do = 90 /* DoKeyword */,
//     \\_a.else = 91 /* ElseKeyword */,
//     \\_a.enum = 92 /* EnumKeyword */,
//     \\_a.export = 93 /* ExportKeyword */,
//     \\_a.extends = 94 /* ExtendsKeyword */,
//     \\_a.false = 95 /* FalseKeyword */,
//     \\_a.finally = 96 /* FinallyKeyword */,
//     \\_a.for = 97 /* ForKeyword */,
//     \\_a.from = 154 /* FromKeyword */,
//     \\_a.function = 98 /* FunctionKeyword */,
//     \\_a.get = 135 /* GetKeyword */,
//     \\_a.if = 99 /* IfKeyword */,
//     \\_a.implements = 117 /* ImplementsKeyword */,
//     \\_a.import = 100 /* ImportKeyword */,
//     \\_a.in = 101 /* InKeyword */,
//     \\_a.infer = 136 /* InferKeyword */,
//     \\_a.instanceof = 102 /* InstanceOfKeyword */,
//     \\_a.interface = 118 /* InterfaceKeyword */,
//     \\_a.intrinsic = 137 /* IntrinsicKeyword */,
//     \\_a.is = 138 /* IsKeyword */,
//     \\_a.keyof = 139 /* KeyOfKeyword */,
//     \\_a.let = 119 /* LetKeyword */,
//     \\_a.module = 140 /* ModuleKeyword */,
//     \\_a.namespace = 141 /* NamespaceKeyword */,
//     \\_a.never = 142 /* NeverKeyword */,
//     \\_a.new = 103 /* NewKeyword */,
//     \\_a.null = 104 /* NullKeyword */,
//     \\_a.number = 145 /* NumberKeyword */,
//     \\_a.object = 146 /* ObjectKeyword */,
//     \\_a.package = 120 /* PackageKeyword */,
//     \\_a.private = 121 /* PrivateKeyword */,
//     \\_a.protected = 122 /* ProtectedKeyword */,
//     \\_a.public = 123 /* PublicKeyword */,
//     \\_a.override = 157 /* OverrideKeyword */,
//     \\_a.readonly = 143 /* ReadonlyKeyword */,
//     \\_a.require = 144 /* RequireKeyword */,
//     \\_a.global = 155 /* GlobalKeyword */,
//     \\_a.return = 105 /* ReturnKeyword */,
//     \\_a.set = 147 /* SetKeyword */,
//     \\_a.static = 124 /* StaticKeyword */,
//     \\_a.string = 148 /* StringKeyword */,
//     \\_a.super = 106 /* SuperKeyword */,
//     \\_a.switch = 107 /* SwitchKeyword */,
//     \\_a.symbol = 149 /* SymbolKeyword */,
//     \\_a.this = 108 /* ThisKeyword */,
//     \\_a.throw = 109 /* ThrowKeyword */,
//     \\_a.true = 110 /* TrueKeyword */,
//     \\_a.try = 111 /* TryKeyword */,
//     \\_a.type = 150 /* TypeKeyword */,
//     \\_a.typeof = 112 /* TypeOfKeyword */,
//     \\_a.undefined = 151 /* UndefinedKeyword */,
//     \\_a.unique = 152 /* UniqueKeyword */,
//     \\_a.unknown = 153 /* UnknownKeyword */,
//     \\_a.var = 113 /* VarKeyword */,
//     \\_a.void = 114 /* VoidKeyword */,
//     \\_a.while = 115 /* WhileKeyword */,
//     \\_a.with = 116 /* WithKeyword */,
//     \\_a.yield = 125 /* YieldKeyword */,
//     \\_a.async = 130 /* AsyncKeyword */,
//     \\_a.await = 131 /* AwaitKeyword */,
//     \\_a.of = 158 /* OfKeyword */,
//     \\_a);
//     \\var textToKeyword = new ts.Map(ts.getEntries(ts.textToKeywordObj));
//     \\var textToToken = new ts.Map(ts.getEntries(__assign(__assign({}, ts.textToKeywordObj), { "{": 18 /* OpenBraceToken */, "}": 19 /* CloseBraceToken */, "(": 20 /* OpenParenToken */, ")": 21 /* CloseParenToken */, "[": 22 /* OpenBracketToken */, "]": 23 /* CloseBracketToken */, ".": 24 /* DotToken */, "...": 25 /* DotDotDotToken */, ";": 26 /* SemicolonToken */, ",": 27 /* CommaToken */, "<": 29 /* LessThanToken */, ">": 31 /* GreaterThanToken */, "<=": 32 /* LessThanEqualsToken */, ">=": 33 /* GreaterThanEqualsToken */, "==": 34 /* EqualsEqualsToken */, "!=": 35 /* ExclamationEqualsToken */, "===": 36 /* EqualsEqualsEqualsToken */, "!==": 37 /* ExclamationEqualsEqualsToken */, "=>": 38 /* EqualsGreaterThanToken */, "+": 39 /* PlusToken */, "-": 40 /* MinusToken */, "**": 42 /* AsteriskAsteriskToken */, "*": 41 /* AsteriskToken */, "/": 43 /* SlashToken */, "%": 44 /* PercentToken */, "++": 45 /* PlusPlusToken */, "--": 46 /* MinusMinusToken */, "<<": 47 /* LessThanLessThanToken */, "</": 30 /* LessThanSlashToken */, ">>": 48 /* GreaterThanGreaterThanToken */, ">>>": 49 /* GreaterThanGreaterThanGreaterThanToken */, "&": 50 /* AmpersandToken */, "|": 51 /* BarToken */, "^": 52 /* CaretToken */, "!": 53 /* ExclamationToken */, "~": 54 /* TildeToken */, "&&": 55 /* AmpersandAmpersandToken */, "||": 56 /* BarBarToken */, "?": 57 /* QuestionToken */, "??": 60 /* QuestionQuestionToken */, "?.": 28 /* QuestionDotToken */, ":": 58 /* ColonToken */, "=": 63 /* EqualsToken */, "+=": 64 /* PlusEqualsToken */, "-=": 65 /* MinusEqualsToken */, "*=": 66 /* AsteriskEqualsToken */, "**=": 67 /* AsteriskAsteriskEqualsToken */, "/=": 68 /* SlashEqualsToken */, "%=": 69 /* PercentEqualsToken */, "<<=": 70 /* LessThanLessThanEqualsToken */, ">>=": 71 /* GreaterThanGreaterThanEqualsToken */, ">>>=": 72 /* GreaterThanGreaterThanGreaterThanEqualsToken */, "&=": 73 /* AmpersandEqualsToken */, "|=": 74 /* BarEqualsToken */, "^=": 78 /* CaretEqualsToken */, "||=": 75 /* BarBarEqualsToken */, "&&=": 76 /* AmpersandAmpersandEqualsToken */, "??=": 77 /* QuestionQuestionEqualsToken */, "@": 59 /* AtToken */, "#": 62 /* HashToken */, "`": 61 /* BacktickToken */ })));
//     \\/*
//     \\As per ECMAScript Language Specification 3th Edition, Section 7.6: Identifiers
//     \\IdentifierStart ::
//     \\Can contain Unicode 3.0.0 categories:
//     \\Uppercase letter (Lu),
//     \\Lowercase letter (Ll),
//     \\Titlecase letter (Lt),
//     \\Modifier letter (Lm),
//     \\Other letter (Lo), or
//     \\Letter number (Nl).
//     \\IdentifierPart :: =
//     \\Can contain IdentifierStart + Unicode 3.0.0 categories:
//     \\Non-spacing mark (Mn),
//     \\Combining spacing mark (Mc),
//     \\Decimal number (Nd), or
//     \\Connector punctuation (Pc).
//     \\
//     \\Codepoint ranges for ES3 Identifiers are extracted from the Unicode 3.0.0 specification at:
//     \\http://www.unicode.org/Public/3.0-Update/UnicodeData-3.0.0.txt
//     \\*/
//     \\var unicodeES3IdentifierStart = [170, 170, 181, 181, 186, 186, 192, 214, 216, 246, 248, 543, 546, 563, 592, 685, 688, 696, 699, 705, 720, 721, 736, 740, 750, 750, 890, 890, 902, 902, 904, 906, 908, 908, 910, 929, 931, 974, 976, 983, 986, 1011, 1024, 1153, 1164, 1220, 1223, 1224, 1227, 1228, 1232, 1269, 1272, 1273, 1329, 1366, 1369, 1369, 1377, 1415, 1488, 1514, 1520, 1522, 1569, 1594, 1600, 1610, 1649, 1747, 1749, 1749, 1765, 1766, 1786, 1788, 1808, 1808, 1810, 1836, 1920, 1957, 2309, 2361, 2365, 2365, 2384, 2384, 2392, 2401, 2437, 2444, 2447, 2448, 2451, 2472, 2474, 2480, 2482, 2482, 2486, 2489, 2524, 2525, 2527, 2529, 2544, 2545, 2565, 2570, 2575, 2576, 2579, 2600, 2602, 2608, 2610, 2611, 2613, 2614, 2616, 2617, 2649, 2652, 2654, 2654, 2674, 2676, 2693, 2699, 2701, 2701, 2703, 2705, 2707, 2728, 2730, 2736, 2738, 2739, 2741, 2745, 2749, 2749, 2768, 2768, 2784, 2784, 2821, 2828, 2831, 2832, 2835, 2856, 2858, 2864, 2866, 2867, 2870, 2873, 2877, 2877, 2908, 2909, 2911, 2913, 2949, 2954, 2958, 2960, 2962, 2965, 2969, 2970, 2972, 2972, 2974, 2975, 2979, 2980, 2984, 2986, 2990, 2997, 2999, 3001, 3077, 3084, 3086, 3088, 3090, 3112, 3114, 3123, 3125, 3129, 3168, 3169, 3205, 3212, 3214, 3216, 3218, 3240, 3242, 3251, 3253, 3257, 3294, 3294, 3296, 3297, 3333, 3340, 3342, 3344, 3346, 3368, 3370, 3385, 3424, 3425, 3461, 3478, 3482, 3505, 3507, 3515, 3517, 3517, 3520, 3526, 3585, 3632, 3634, 3635, 3648, 3654, 3713, 3714, 3716, 3716, 3719, 3720, 3722, 3722, 3725, 3725, 3732, 3735, 3737, 3743, 3745, 3747, 3749, 3749, 3751, 3751, 3754, 3755, 3757, 3760, 3762, 3763, 3773, 3773, 3776, 3780, 3782, 3782, 3804, 3805, 3840, 3840, 3904, 3911, 3913, 3946, 3976, 3979, 4096, 4129, 4131, 4135, 4137, 4138, 4176, 4181, 4256, 4293, 4304, 4342, 4352, 4441, 4447, 4514, 4520, 4601, 4608, 4614, 4616, 4678, 4680, 4680, 4682, 4685, 4688, 4694, 4696, 4696, 4698, 4701, 4704, 4742, 4744, 4744, 4746, 4749, 4752, 4782, 4784, 4784, 4786, 4789, 4792, 4798, 4800, 4800, 4802, 4805, 4808, 4814, 4816, 4822, 4824, 4846, 4848, 4878, 4880, 4880, 4882, 4885, 4888, 4894, 4896, 4934, 4936, 4954, 5024, 5108, 5121, 5740, 5743, 5750, 5761, 5786, 5792, 5866, 6016, 6067, 6176, 6263, 6272, 6312, 7680, 7835, 7840, 7929, 7936, 7957, 7960, 7965, 7968, 8005, 8008, 8013, 8016, 8023, 8025, 8025, 8027, 8027, 8029, 8029, 8031, 8061, 8064, 8116, 8118, 8124, 8126, 8126, 8130, 8132, 8134, 8140, 8144, 8147, 8150, 8155, 8160, 8172, 8178, 8180, 8182, 8188, 8319, 8319, 8450, 8450, 8455, 8455, 8458, 8467, 8469, 8469, 8473, 8477, 8484, 8484, 8486, 8486, 8488, 8488, 8490, 8493, 8495, 8497, 8499, 8505, 8544, 8579, 12293, 12295, 12321, 12329, 12337, 12341, 12344, 12346, 12353, 12436, 12445, 12446, 12449, 12538, 12540, 12542, 12549, 12588, 12593, 12686, 12704, 12727, 13312, 19893, 19968, 40869, 40960, 42124, 44032, 55203, 63744, 64045, 64256, 64262, 64275, 64279, 64285, 64285, 64287, 64296, 64298, 64310, 64312, 64316, 64318, 64318, 64320, 64321, 64323, 64324, 64326, 64433, 64467, 64829, 64848, 64911, 64914, 64967, 65008, 65019, 65136, 65138, 65140, 65140, 65142, 65276, 65313, 65338, 65345, 65370, 65382, 65470, 65474, 65479, 65482, 65487, 65490, 65495, 65498, 65500,];
//     \\var unicodeES3IdentifierPart = [170, 170, 181, 181, 186, 186, 192, 214, 216, 246, 248, 543, 546, 563, 592, 685, 688, 696, 699, 705, 720, 721, 736, 740, 750, 750, 768, 846, 864, 866, 890, 890, 902, 902, 904, 906, 908, 908, 910, 929, 931, 974, 976, 983, 986, 1011, 1024, 1153, 1155, 1158, 1164, 1220, 1223, 1224, 1227, 1228, 1232, 1269, 1272, 1273, 1329, 1366, 1369, 1369, 1377, 1415, 1425, 1441, 1443, 1465, 1467, 1469, 1471, 1471, 1473, 1474, 1476, 1476, 1488, 1514, 1520, 1522, 1569, 1594, 1600, 1621, 1632, 1641, 1648, 1747, 1749, 1756, 1759, 1768, 1770, 1773, 1776, 1788, 1808, 1836, 1840, 1866, 1920, 1968, 2305, 2307, 2309, 2361, 2364, 2381, 2384, 2388, 2392, 2403, 2406, 2415, 2433, 2435, 2437, 2444, 2447, 2448, 2451, 2472, 2474, 2480, 2482, 2482, 2486, 2489, 2492, 2492, 2494, 2500, 2503, 2504, 2507, 2509, 2519, 2519, 2524, 2525, 2527, 2531, 2534, 2545, 2562, 2562, 2565, 2570, 2575, 2576, 2579, 2600, 2602, 2608, 2610, 2611, 2613, 2614, 2616, 2617, 2620, 2620, 2622, 2626, 2631, 2632, 2635, 2637, 2649, 2652, 2654, 2654, 2662, 2676, 2689, 2691, 2693, 2699, 2701, 2701, 2703, 2705, 2707, 2728, 2730, 2736, 2738, 2739, 2741, 2745, 2748, 2757, 2759, 2761, 2763, 2765, 2768, 2768, 2784, 2784, 2790, 2799, 2817, 2819, 2821, 2828, 2831, 2832, 2835, 2856, 2858, 2864, 2866, 2867, 2870, 2873, 2876, 2883, 2887, 2888, 2891, 2893, 2902, 2903, 2908, 2909, 2911, 2913, 2918, 2927, 2946, 2947, 2949, 2954, 2958, 2960, 2962, 2965, 2969, 2970, 2972, 2972, 2974, 2975, 2979, 2980, 2984, 2986, 2990, 2997, 2999, 3001, 3006, 3010, 3014, 3016, 3018, 3021, 3031, 3031, 3047, 3055, 3073, 3075, 3077, 3084, 3086, 3088, 3090, 3112, 3114, 3123, 3125, 3129, 3134, 3140, 3142, 3144, 3146, 3149, 3157, 3158, 3168, 3169, 3174, 3183, 3202, 3203, 3205, 3212, 3214, 3216, 3218, 3240, 3242, 3251, 3253, 3257, 3262, 3268, 3270, 3272, 3274, 3277, 3285, 3286, 3294, 3294, 3296, 3297, 3302, 3311, 3330, 3331, 3333, 3340, 3342, 3344, 3346, 3368, 3370, 3385, 3390, 3395, 3398, 3400, 3402, 3405, 3415, 3415, 3424, 3425, 3430, 3439, 3458, 3459, 3461, 3478, 3482, 3505, 3507, 3515, 3517, 3517, 3520, 3526, 3530, 3530, 3535, 3540, 3542, 3542, 3544, 3551, 3570, 3571, 3585, 3642, 3648, 3662, 3664, 3673, 3713, 3714, 3716, 3716, 3719, 3720, 3722, 3722, 3725, 3725, 3732, 3735, 3737, 3743, 3745, 3747, 3749, 3749, 3751, 3751, 3754, 3755, 3757, 3769, 3771, 3773, 3776, 3780, 3782, 3782, 3784, 3789, 3792, 3801, 3804, 3805, 3840, 3840, 3864, 3865, 3872, 3881, 3893, 3893, 3895, 3895, 3897, 3897, 3902, 3911, 3913, 3946, 3953, 3972, 3974, 3979, 3984, 3991, 3993, 4028, 4038, 4038, 4096, 4129, 4131, 4135, 4137, 4138, 4140, 4146, 4150, 4153, 4160, 4169, 4176, 4185, 4256, 4293, 4304, 4342, 4352, 4441, 4447, 4514, 4520, 4601, 4608, 4614, 4616, 4678, 4680, 4680, 4682, 4685, 4688, 4694, 4696, 4696, 4698, 4701, 4704, 4742, 4744, 4744, 4746, 4749, 4752, 4782, 4784, 4784, 4786, 4789, 4792, 4798, 4800, 4800, 4802, 4805, 4808, 4814, 4816, 4822, 4824, 4846, 4848, 4878, 4880, 4880, 4882, 4885, 4888, 4894, 4896, 4934, 4936, 4954, 4969, 4977, 5024, 5108, 5121, 5740, 5743, 5750, 5761, 5786, 5792, 5866, 6016, 6099, 6112, 6121, 6160, 6169, 6176, 6263, 6272, 6313, 7680, 7835, 7840, 7929, 7936, 7957, 7960, 7965, 7968, 8005, 8008, 8013, 8016, 8023, 8025, 8025, 8027, 8027, 8029, 8029, 8031, 8061, 8064, 8116, 8118, 8124, 8126, 8126, 8130, 8132, 8134, 8140, 8144, 8147, 8150, 8155, 8160, 8172, 8178, 8180, 8182, 8188, 8255, 8256, 8319, 8319, 8400, 8412, 8417, 8417, 8450, 8450, 8455, 8455, 8458, 8467, 8469, 8469, 8473, 8477, 8484, 8484, 8486, 8486, 8488, 8488, 8490, 8493, 8495, 8497, 8499, 8505, 8544, 8579, 12293, 12295, 12321, 12335, 12337, 12341, 12344, 12346, 12353, 12436, 12441, 12442, 12445, 12446, 12449, 12542, 12549, 12588, 12593, 12686, 12704, 12727, 13312, 19893, 19968, 40869, 40960, 42124, 44032, 55203, 63744, 64045, 64256, 64262, 64275, 64279, 64285, 64296, 64298, 64310, 64312, 64316, 64318, 64318, 64320, 64321, 64323, 64324, 64326, 64433, 64467, 64829, 64848, 64911, 64914, 64967, 65008, 65019, 65056, 65059, 65075, 65076, 65101, 65103, 65136, 65138, 65140, 65140, 65142, 65276, 65296, 65305, 65313, 65338, 65343, 65343, 65345, 65370, 65381, 65470, 65474, 65479, 65482, 65487, 65490, 65495, 65498, 65500,];
//     \\/*
//     \\As per ECMAScript Language Specification 5th Edition, Section 7.6: ISyntaxToken Names and Identifiers
//     \\IdentifierStart ::
//     \\Can contain Unicode 6.2 categories:
//     \\Uppercase letter (Lu),
//     \\Lowercase letter (Ll),
//     \\Titlecase letter (Lt),
//     \\Modifier letter (Lm),
//     \\Other letter (Lo), or
//     \\Letter number (Nl).
//     \\IdentifierPart ::㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️
//     \\Can contain IdentifierStart + Unicode 6.2 categories:
//     \\Non-spacing mark (Mn),
//     \\Combining spacing mark (Mc),
//     \\Decimal number (Nd),
//     \\Connector punctuation (Pc),
//     \\<ZWNJ>, or
//     \\<ZWJ>.
//     \\
//     \\Codepoint ranges for ES5 Identifiers are extracted from the Unicode 6.2 specification at:
//     \\http://www.unicode.org/Public/6.2.0/ucd/UnicodeData.txt
//     \\*/
//     \\var unicodeES5IdentifierStart = [170, 170, 181, 181, 186, 186, 192, 214, 216, 246, 248, 705, 710, 721, 736, 740, 748, 748, 750, 750, 880, 884, 886, 887, 890, 893, 902, 902, 904, 906, 908, 908, 910, 929, 931, 1013, 1015, 1153, 1162, 1319, 1329, 1366, 1369, 1369, 1377, 1415, 1488, 1514, 1520, 1522, 1568, 1610, 1646, 1647, 1649, 1747, 1749, 1749, 1765, 1766, 1774, 1775, 1786, 1788, 1791, 1791, 1808, 1808, 1810, 1839, 1869, 1957, 1969, 1969, 1994, 2026, 2036, 2037, 2042, 2042, 2048, 2069, 2074, 2074, 2084, 2084, 2088, 2088, 2112, 2136, 2208, 2208, 2210, 2220, 2308, 2361, 2365, 2365, 2384, 2384, 2392, 2401, 2417, 2423, 2425, 2431, 2437, 2444, 2447, 2448, 2451, 2472, 2474, 2480, 2482, 2482, 2486, 2489, 2493, 2493, 2510, 2510, 2524, 2525, 2527, 2529, 2544, 2545, 2565, 2570, 2575, 2576, 2579, 2600, 2602, 2608, 2610, 2611, 2613, 2614, 2616, 2617, 2649, 2652, 2654, 2654, 2674, 2676, 2693, 2701, 2703, 2705, 2707, 2728, 2730, 2736, 2738, 2739, 2741, 2745, 2749, 2749, 2768, 2768, 2784, 2785, 2821, 2828, 2831, 2832, 2835, 2856, 2858, 2864, 2866, 2867, 2869, 2873, 2877, 2877, 2908, 2909, 2911, 2913, 2929, 2929, 2947, 2947, 2949, 2954, 2958, 2960, 2962, 2965, 2969, 2970, 2972, 2972, 2974, 2975, 2979, 2980, 2984, 2986, 2990, 3001, 3024, 3024, 3077, 3084, 3086, 3088, 3090, 3112, 3114, 3123, 3125, 3129, 3133, 3133, 3160, 3161, 3168, 3169, 3205, 3212, 3214, 3216, 3218, 3240, 3242, 3251, 3253, 3257, 3261, 3261, 3294, 3294, 3296, 3297, 3313, 3314, 3333, 3340, 3342, 3344, 3346, 3386, 3389, 3389, 3406, 3406, 3424, 3425, 3450, 3455, 3461, 3478, 3482, 3505, 3507, 3515, 3517, 3517, 3520, 3526, 3585, 3632, 3634, 3635, 3648, 3654, 3713, 3714, 3716, 3716, 3719, 3720, 3722, 3722, 3725, 3725, 3732, 3735, 3737, 3743, 3745, 3747, 3749, 3749, 3751, 3751, 3754, 3755, 3757, 3760, 3762, 3763, 3773, 3773, 3776, 3780, 3782, 3782, 3804, 3807, 3840, 3840, 3904, 3911, 3913, 3948, 3976, 3980, 4096, 4138, 4159, 4159, 4176, 4181, 4186, 4189, 4193, 4193, 4197, 4198, 4206, 4208, 4213, 4225, 4238, 4238, 4256, 4293, 4295, 4295, 4301, 4301, 4304, 4346, 4348, 4680, 4682, 4685, 4688, 4694, 4696, 4696, 4698, 4701, 4704, 4744, 4746, 4749, 4752, 4784, 4786, 4789, 4792, 4798, 4800, 4800, 4802, 4805, 4808, 4822, 4824, 4880, 4882, 4885, 4888, 4954, 4992, 5007, 5024, 5108, 5121, 5740, 5743, 5759, 5761, 5786, 5792, 5866, 5870, 5872, 5888, 5900, 5902, 5905, 5920, 5937, 5952, 5969, 5984, 5996, 5998, 6000, 6016, 6067, 6103, 6103, 6108, 6108, 6176, 6263, 6272, 6312, 6314, 6314, 6320, 6389, 6400, 6428, 6480, 6509, 6512, 6516, 6528, 6571, 6593, 6599, 6656, 6678, 6688, 6740, 6823, 6823, 6917, 6963, 6981, 6987, 7043, 7072, 7086, 7087, 7098, 7141, 7168, 7203, 7245, 7247, 7258, 7293, 7401, 7404, 7406, 7409, 7413, 7414, 7424, 7615, 7680, 7957, 7960, 7965, 7968, 8005, 8008, 8013, 8016, 8023, 8025, 8025, 8027, 8027, 8029, 8029, 8031, 8061, 8064, 8116, 8118, 8124, 8126, 8126, 8130, 8132, 8134, 8140, 8144, 8147, 8150, 8155, 8160, 8172, 8178, 8180, 8182, 8188, 8305, 8305, 8319, 8319, 8336, 8348, 8450, 8450, 8455, 8455, 8458, 8467, 8469, 8469, 8473, 8477, 8484, 8484, 8486, 8486, 8488, 8488, 8490, 8493, 8495, 8505, 8508, 8511, 8517, 8521, 8526, 8526, 8544, 8584, 11264, 11310, 11312, 11358, 11360, 11492, 11499, 11502, 11506, 11507, 11520, 11557, 11559, 11559, 11565, 11565, 11568, 11623, 11631, 11631, 11648, 11670, 11680, 11686, 11688, 11694, 11696, 11702, 11704, 11710, 11712, 11718, 11720, 11726, 11728, 11734, 11736, 11742, 11823, 11823, 12293, 12295, 12321, 12329, 12337, 12341, 12344, 12348, 12353, 12438, 12445, 12447, 12449, 12538, 12540, 12543, 12549, 12589, 12593, 12686, 12704, 12730, 12784, 12799, 13312, 19893, 19968, 40908, 40960, 42124, 42192, 42237, 42240, 42508, 42512, 42527, 42538, 42539, 42560, 42606, 42623, 42647, 42656, 42735, 42775, 42783, 42786, 42888, 42891, 42894, 42896, 42899, 42912, 42922, 43000, 43009, 43011, 43013, 43015, 43018, 43020, 43042, 43072, 43123, 43138, 43187, 43250, 43255, 43259, 43259, 43274, 43301, 43312, 43334, 43360, 43388, 43396, 43442, 43471, 43471, 43520, 43560, 43584, 43586, 43588, 43595, 43616, 43638, 43642, 43642, 43648, 43695, 43697, 43697, 43701, 43702, 43705, 43709, 43712, 43712, 43714, 43714, 43739, 43741, 43744, 43754, 43762, 43764, 43777, 43782, 43785, 43790, 43793, 43798, 43808, 43814, 43816, 43822, 43968, 44002, 44032, 55203, 55216, 55238, 55243, 55291, 63744, 64109, 64112, 64217, 64256, 64262, 64275, 64279, 64285, 64285, 64287, 64296, 64298, 64310, 64312, 64316, 64318, 64318, 64320, 64321, 64323, 64324, 64326, 64433, 64467, 64829, 64848, 64911, 64914, 64967, 65008, 65019, 65136, 65140, 65142, 65276, 65313, 65338, 65345, 65370, 65382, 65470, 65474, 65479, 65482, 65487, 65490, 65495, 65498, 65500,];
//     \\var unicodeES5IdentifierPart = [170, 170, 181, 181, 186, 186, 192, 214, 216, 246, 248, 705, 710, 721, 736, 740, 748, 748, 750, 750, 768, 884, 886, ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 887, 890, 893, 902, 902, 904, 906, 908, 908, 910, 929, 931, 1013, 1015, 1153, 1155, 1159, 1162, 1319, 1329, 1366, 1369, 1369, 1377, 1415, 1425, 1469, 1471, 1471, 1473, 1474, 1476, 1477, 1479, 1479, 1488, 1514, 1520, 1522, 1552, 1562, 1568, 1641, 1646, 1747, 1749, 1756, 1759, 1768, 1770, 1788, 1791, 1791, 1808, 1866, 1869, 1969, 1984, 2037, 2042, 2042, 2048, 2093, 2112, 2139, 2208, 2208, 2210, 2220, 2276, 2302, 2304, 2403, 2406, 2415, 2417, 2423, 2425, 2431, 2433, 2435, 2437, 2444, 2447, 2448, 2451, 2472, 2474, 2480, 2482, 2482, 2486, 2489, 2492, 2500, 2503, 2504, 2507, 2510, 2519, 2519, 2524, 2525, 2527, 2531, 2534, 2545, 2561, 2563, 2565, 2570, 2575, 2576, 2579, 2600, 2602, 2608, 2610, 2611, 2613, 2614, 2616, 2617, 2620, 2620, 2622, 2626, 2631, 2632, 2635, 2637, 2641, 2641, 2649, 2652, 2654, 2654, 2662, 2677, 2689, 2691, 2693, 2701, 2703, 2705, 2707, 2728, 2730, 2736, 2738, 2739, 2741, 2745, 2748, 2757, 2759, 2761, 2763, 2765, 2768, 2768, 2784, 2787, 2790, 2799, 2817, 2819, 2821, 2828, 2831, 2832, 2835, 2856, 2858, 2864, 2866, 2867, 2869, 2873, 2876, 2884, 2887, 2888, 2891, 2893, 2902, 2903, 2908, 2909, 2911, 2915, 2918, 2927, 2929, 2929, 2946, 2947, 2949, 2954, 2958, 2960, 2962, 2965, 2969, 2970, 2972, 2972, 2974, 2975, 2979, 2980, 2984, 2986, 2990, 3001, 3006, 3010, 3014, 3016, 3018, 3021, 3024, 3024, 3031, 3031, 3046, 3055, 3073, 3075, 3077, 3084, 3086, 3088, 3090, 3112, 3114, 3123, 3125, 3129, 3133, 3140, 3142, 3144, 3146, 3149, 3157, 3158, 3160, 3161, 3168, 3171, 3174, 3183, 3202, 3203, 3205, 3212, 3214, 3216, 3218, 3240, 3242, 3251, 3253, 3257, 3260, 3268, 3270, 3272, 3274, 3277, 3285, 3286, 3294, 3294, 3296, 3299, 3302, 3311, 3313, 3314, 3330, 3331, 3333, 3340, 3342, 3344, 3346, 3386, 3389, 3396, 3398, 3400, 3402, 3406, 3415, 3415, 3424, 3427, 3430, 3439, 3450, 3455, 3458, 3459, 3461, 3478, 3482, 3505, 3507, 3515, 3517, 3517, 3520, 3526, 3530, 3530, 3535, 3540, 3542, 3542, 3544, 3551, 3570, 3571, 3585, 3642, 3648, 3662, 3664, 3673, 3713, 3714, 3716, 3716, 3719, 3720, 3722, 3722, 3725, 3725, 3732, 3735, 3737, 3743, 3745, 3747, 3749, 3749, 3751, 3751, 3754, 3755, 3757, 3769, 3771, 3773, 3776, 3780, 3782, 3782, 3784, 3789, 3792, 3801, 3804, 3807, 3840, 3840, 3864, 3865, 3872, 3881, 3893, 3893, 3895, 3895, 3897, 3897, 3902, 3911, 3913, 3948, 3953, 3972, 3974, 3991, 3993, 4028, 4038, 4038, 4096, 4169, 4176, 4253, 4256, 4293, 4295, 4295, 4301, 4301, 4304, 4346, 4348, 4680, 4682, 4685, 4688, 4694, 4696, 4696, 4698, 4701, 4704, 4744, 4746, 4749, 4752, 4784, 4786, 4789, 4792, 4798, 4800, 4800, 4802, 4805, 4808, 4822, 4824, 4880, 4882, 4885, 4888, 4954, 4957, 4959, 4992, 5007, 5024, 5108, 5121, 5740, 5743, 5759, 5761, 5786, 5792, 5866, 5870, 5872, 5888, 5900, 5902, 5908, 5920, 5940, 5952, 5971, 5984, 5996, 5998, 6000, 6002, 6003, 6016, 6099, 6103, 6103, 6108, 6109, 6112, 6121, 6155, 6157, 6160, 6169, 6176, 6263, 6272, 6314, 6320, 6389, 6400, 6428, 6432, 6443, 6448, 6459, 6470, 6509, 6512, 6516, 6528, 6571, 6576, 6601, 6608, 6617, 6656, 6683, 6688, 6750, 6752, 6780, 6783, 6793, 6800, 6809, 6823, 6823, 6912, 6987, 6992, 7001, 7019, 7027, 7040, 7155, 7168, 7223, 7232, 7241, 7245, 7293, 7376, 7378, 7380, 7414, 7424, 7654, 7676, 7957, 7960, 7965, 7968, 8005, 8008, 8013, 8016, 8023, 8025, 8025, 8027, 8027, 8029, 8029, 8031, 8061, 8064, 8116, 8118, 8124, 8126, 8126, 8130, 8132, 8134, 8140, 8144, 8147, 8150, 8155, 8160, 8172, 8178, 8180, 8182, 8188, 8204, 8205, 8255, 8256, 8276, 8276, 8305, 8305, 8319, 8319, 8336, 8348, 8400, 8412, 8417, 8417, 8421, 8432, 8450, 8450, 8455, 8455, 8458, 8467, 8469, 8469, 8473, 8477, 8484, 8484, 8486, 8486, 8488, 8488, 8490, 8493, 8495, 8505, 8508, 8511, 8517, 8521, 8526, 8526, 8544, 8584, 11264, 11310, 11312, 11358, 11360, 11492, 11499, 11507, 11520, 11557, 11559, 11559, 11565, 11565, 11568, 11623, 11631, 11631, 11647, 11670, 11680, 11686, 11688, 11694, 11696, 11702, 11704, 11710, 11712, 11718, 11720, 11726, 11728, 11734, 11736, 11742, 11744, 11775, 11823, 11823, 12293, 12295, 12321, 12335, 12337, 12341, 12344, 12348, 12353, 12438, 12441, 12442, 12445, 12447, 12449, 12538, 12540, 12543, 12549, 12589, 12593, 12686, 12704, 12730, 12784, 12799, 13312, 19893, 19968, 40908, 40960, 42124, 42192, 42237, 42240, 42508, 42512, 42539, 42560, 42607, 42612, 42621, 42623, 42647, 42655, 42737, 42775, 42783, 42786, 42888, 42891, 42894, 42896, 42899, 42912, 42922, 43000, 43047, 43072, 43123, 43136, 43204, 43216, 43225, 43232, 43255, 43259, 43259, 43264, 43309, 43312, 43347, 43360, 43388, 43392, 43456, 43471, 43481, 43520, 43574, 43584, 43597, 43600, 43609, 43616, 43638, 43642, 43643, 43648, 43714, 43739, 43741, 43744, 43759, 43762, 43766, 43777, 43782, 43785, 43790, 43793, 43798, 43808, 43814, 43816, 43822, 43968, 44010, 44012, 44013, 44016, 44025, 44032, 55203, 55216, 55238, 55243, 55291, 63744, 64109, 64112, 64217, 64256, 64262, 64275, 64279, 64285, 64296, 64298, 64310, 64312, 64316, 64318, 64318, 64320, 64321, 64323, 64324, 64326, 64433, 64467, 64829, 64848, 64911, 64914, 64967, 65008, 65019, 65024, 65039, 65056, 65062, 65075, 65076, 65101, 65103, 65136, 65140, 65142, 65276, 65296, 65305, 65313, 65338, 65343, 65343, 65345, 65370, 65382, 65470, 65474, 65479, 65482, 65487, 65490, 65495, 65498, 65500,];
//     \\/**
//     \\* Generated by scripts/regenerate-unicode-identifier-parts.js on node v12.4.0 with unicode 12.1
//     \\* based on http://www.unicode.org/reports/tr31/ and https://www.ecma-international.org/ecma-262/6.0/#sec-names-and-keywords
//     \\* unicodeESNextIdentifierSt💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 art corresponds to the ID_Start and Other_ID_Start property, and
//     \\* unicodeESNextIdentifierPart corresponds to ID_Continue, Other_ID_Continue, plus ID_Start and Other_ID_Start
//     \\*/
//     \\var unicodeESNextIdentifierStart = [65, 90, 97, 122, 170, 170, 181, 181, 186, 186, 192, 214, 216, 246, 248, 705, 710, 721, 736, 740, 748, 748, 750, 750, 880, 884, 886, 887, 890, 893, 895, 895, 902, 902, 904, 906, 908, 908, 910, 929, 931, 1013, 1015, 1153, 1162, 1327, 1329, 1366, 1369, 1369, 1376, 1416, 1488, 1514, 1519, 1522, 1568, 1610, 1646, 1647, 1649, 1747, 1749, 1749, 1765, 1766, 1774, 1775, 1786, 1788, 1791, 1791, 1808, 1808, 1810, 1839, 1869, 1957, 1969, 1969, 1994, 2026, 2036, 2037, 2042, 2042, 2048, 2069, 2074, 2074, 2084, 2084, 2088, 2088, 2112, 2136, 2144, 2154, 2208, 2228, 2230, 2237, 2308, 2361, 2365, 2365, 2384, 2384, 2392, 2401, 2417, 2432, 2437, 2444, 2447, 2448, 2451, 2472, 2474, 2480, 2482, 2482, 2486, 2489, 2493, 2493, 2510, 2510, 2524, 2525, 2527, 2529, 2544, 2545, 2556, 2556, 2565, 2570, 2575, 2576, 2579, 2600, 2602, 2608, 2610, 2611, 2613, 2614, 2616, 2617, 2649, 2652, 2654, 2654, 2674, 2676, 2693, 2701, 2703, 2705, 2707, 2728, 2730, 2736, 2738, 2739, 2741, 2745, 2749, 2749, 2768, 2768, 2784, 2785, 2809, 2809, 2821, 2828, 2831, 2832, 2835, 2856, 2858, 2864, 2866, 2867, 2869, 2873, 2877, 2877, 2908, 2909, 2911, 2913, 2929, 2929, 2947, 2947, 2949, 2954, 2958, 2960, 2962, 2965, 2969, 2970, 2972, 2972, 2974, 2975, 2979, 2980, 2984, 2986, 2990, 3001, 3024, 3024, 3077, 3084, 3086, 3088, 3090, 3112, 3114, 3129, 3133, 3133, 3160, 3162, 3168, 3169, 3200, 3200, 3205, 3212, 3214, 3216, 3218, 3240, 3242, 3251, 3253, 3257, 3261, 3261, 3294, 3294, 3296, 3297, 3313, 3314, 3333, 3340, 3342, 3344, 3346, 3386, 3389, 3389, 3406, 3406, 3412, 3414, 3423, 3425, 3450, 3455, 3461, 3478, 3482, 3505, 3507, 3515, 3517, 3517, 3520, 3526, 3585, 3632, 3634, 3635, 3648, 3654, 3713, 3714, 3716, 3716, 3718, 3722, 3724, 3747, 3749, 3749, 3751, 3760, 3762, 3763, 3773, 3773, 3776, 3780, 3782, 3782, 3804, 3807, 3840, 3840, 3904, 3911, 3913, 3948, 3976, 3980, 4096, 4138, 4159, 4159, 4176, 4181, 4186, 4189, 4193, 4193, 4197, 4198, 4206, 4208, 4213, 4225, 4238, 4238, 4256, 4293, 4295, 4295, 4301, 4301, 4304, 4346, 4348, 4680, 4682, 4685, 4688, 4694, 4696, 4696, 4698, 4701, 4704, 4744, 4746, 4749, 4752, 4784, 4786, 4789, 4792, 4798, 4800, 4800, 4802, 4805, 4808, 4822, 4824, 4880, 4882, 4885, 4888, 4954, 4992, 5007, 5024, 5109, 5112, 5117, 5121, 5740, 5743, 5759, 5761, 5786, 5792, 5866, 5870, 5880, 5888, 5900, 5902, 5905, 5920, 5937, 5952, 5969, 5984, 5996, 5998, 6000, 6016, 6067, 6103, 6103, 6108, 6108, 6176, 6264, 6272, 6312, 6314, 6314, 6320, 6389, 6400, 6430, 6480, 6509, 6512, 6516, 6528, 6571, 6576, 6601, 6656, 6678, 6688, 6740, 6823, 6823, 6917, 6963, 6981, 6987, 7043, 7072, 7086, 7087, 7098, 7141, 7168, 7203, 7245, 7247, 7258, 7293, 7296, 7304, 7312, 7354, 7357, 7359, 7401, 7404, 7406, 7411, 7413, 7414, 7418, 7418, 7424, 7615, 7680, 7957, 7960, 7965, 7968, 8005, 8008, 8013, 8016, 8023, 8025, 8025, 8027, 8027, 8029, 8029, 8031, 8061, 8064, 8116, 8118, 8124, 8126, 8126, 8130, 8132, 8134, 8140, 8144, 8147, 8150, 8155, 8160, 8172, 8178, 8180, 8182, 8188, 8305, 8305, 8319, 8319, 8336, 8348, 8450, 8450, 8455, 8455, 8458, 8467, 8469, 8469, 8472, 8477, 8484, 8484, 8486, 8486, 8488, 8488, 8490, 8505, 8508, 8511, 8517, 8521, 8526, 8526, 8544, 8584, 11264, 11310, 11312, 11358, 11360, 11492, 11499, 11502, 11506, 11507, 11520, 11557, 11559, 11559, 11565, 11565, 11568, 11623, 11631, 11631, 11648, 11670, 11680, 11686, 11688, 11694, 11696, 11702, 11704, 11710, 11712, 11718, 11720, 11726, 11728, 11734, 11736, 11742, 12293, 12295, 12321, 12329, 12337, 12341, 12344, 12348, 12353, 12438, 12443, 12447, 12449, 12538, 12540, 12543, 12549, 12591, 12593, 12686, 12704, 12730, 12784, 12799, 13312, 19893, 19968, 40943, 40960, 42124, 42192, 42237, 42240, 42508, 42512, 42527, 42538, 42539, 42560, 42606, 42623, 42653, 42656, 42735, 42775, 42783, 42786, 42888, 42891, 42943, 42946, 42950, 42999, 43009, 43011, 43013, 43015, 43018, 43020, 43042, 43072, 43123, 43138, 43187, 43250, 43255, 43259, 43259, 43261, 43262, 43274, 43301, 43312, 43334, 43360, 43388, 43396, 43442, 43471, 43471, 43488, 43492, 43494, 43503, 43514, 43518, 43520, 43560, 43584, 43586, 43588, 43595, 43616, 43638, 43642, 43642, 43646, 43695, 43697, 43697, 43701, 43702, 43705, 43709, 43712, 43712, 43714, 43714, 43739, 43741, 43744, 43754, 43762, 43764, 43777, 43782, 43785, 43790, 43793, 43798, 43808, 43814, 43816, 43822, 43824, 43866, 43868, 43879, 43888, 44002, 44032, 55203, 55216, 55238, 55243, 55291, 63744, 64109, 64112, 64217, 64256, 64262, 64275, 64279, 64285, 64285, 64287, 64296, 64298, 64310, 64312, 64316, 64318, 64318, 64320, 64321, 64323, 64324, 64326, 64433, 64467, 64829, 64848, 64911, 64914, 64967, 65008, 65019, 65136, 65140, 65142, 65276, 65313, 65338, 65345, 65370, 65382, 65470, 65474, 65479, 65482, 65487, 65490, 65495, 65498, 65500, 65536, 65547, 65549, 65574, 65576, 65594, 65596, 65597, 65599, 65613, 65616, 65629, 65664, 65786, 65856, 65908, 66176, 66204, 66208, 66256, 66304, 66335, 66349, 66378, 66384, 66421, 66432, 66461, 66464, 66499, 66504, 66511, 66513, 66517, 66560, 66717, 66736, 66771, 66776, 66811, 66816, 66855, 66864, 66915, 67072, 67382, 67392, 67413, 67424, 67431, 67584, 67589, 67592, 67592, 67594, 67637, 67639, 67640, 67644, 67644, 67647, 67669, 67680, 67702, 67712, 67742, 67808, 67826, 67828, 67829, 67840, 67861, 67872, 67897, 67968, 68023, 68030, 68031, 68096, 68096, 68112, 68115, 68117, 68119, 68121, 68149, 68192, 68220, 68224, 68252, 68288, 68295, 68297, 68324, 68352, 68405, 68416, 68437, 68448, 68466, 68480, 68497, 68608, 68680, 68736, 68786, 68800, 68850, 68864, 68899, 69376, 69404, 69415, 69415, 69424, 69445, 69600, 69622, 69635, 69687, 69763, 69807, 69840, 69864, 69891, 69926, 69956, 69956, 69968, 70002, 70006, 70006, 70019, 70066, 70081, 70084, 70106, 70106, 70108, 70108, 70144, 70161, 70163, 70187, 70272, 70278, 70280, 70280, 70282, 70285, 70287, 70301, 70303, 70312, 70320, 70366, 70405, 70412, 70415, 70416, 70419, 70440, 70442, 70448, 70450, 70451, 70453, 70457, 70461, 70461, 70480, 70480, 70493, 70497, 70656, 70708, 70727, 70730, 70751, 70751, 70784, 70831, 70852, 70853, 70855, 70855, 71040, 71086, 71128, 71131, 71168, 71215, 71236, 71236, 71296, 71338, 71352, 71352, 71424, 71450, 71680, 71723, 71840, 71903, 71935, 71935, 72096, 72103, 72106, 72144, 72161, 72161, 72163, 72163, 72192, 72192, 72203, 72242, 72250, 72250, 72272, 72272, 72284, 72329, 72349, 72349, 72384, 72440, 72704, 72712, 72714, 72750, 72768, 72768, 72818, 72847, 72960, 72966, 72968, 72969, 72971, 73008, 73030, 73030, 73056, 73061, 73063, 73064, 73066, 73097, 73112, 73112, 73440, 73458, 73728, 74649, 74752, 74862, 74880, 75075, 77824, 78894, 82944, 83526, 92160, 92728, 92736, 92766, 92880, 92909, 92928, 92975, 92992, 92995, 93027, 93047, 93053, 93071, 93760, 93823, 93952, 94026, 94032, 94032, 94099, 94111, 94176, 94177, 94179, 94179, 94208, 100343, 100352, 101106, 110592, 110878, 110928, 110930, 110948, 110951, 110960, 111355, 113664, 113770, 113776, 113788, 113792, 113800, 113808, 113817, 119808, 119892, 119894, 119964, 119966, 119967, 119970, 119970, 119973, 119974, 119977, 119980, 119982, 119993, 119995, 119995, 119997, 120003, 120005, 120069, 120071, 120074, 120077, 120084, 120086, 120092, 120094, 120121, 120123, 120126, 120128, 120132, 120134, 120134, 120138, 120144, 120146, 120485, 120488, 120512, 120514, 120538, 120540, 120570, 120572, 120596, 120598, 120628, 120630, 120654, 120656, 120686, 120688, 120712, 120714, 120744, 120746, 120770, 120772, 120779, 123136, 123180, 123191, 123197, 123214, 123214, 123584, 123627, 124928, 125124, 125184, 125251, 125259, 125259, 126464, 126467, 126469, 126495, 126497, 126498, 126500, 126500, 126503, 126503, 126505, 126514, 126516, 126519, 126521, 126521, 126523, 126523, 126530, 126530, 126535, 126535, 126537, 126537, 126539, 126539, 126541, 126543, 126545, 126546, 126548, 126548, 126551, 126551, 126553, 126553, 126555, 126555, 126557, 126557, 126559, 126559, 126561, 126562, 126564, 126564, 126567, 126570, 126572, 126578, 126580, 126583, 126585, 126588, 126590, 126590, 126592, 126601, 126603, 126619, 126625, 126627, 126629, 126633, 126635, 126651, 131072, 173782, 173824, 177972, 177984, 178205, 178208, 183969, 183984, 191456, 194560, 195101];
//     \\var unicodeESNextIdentifierPart = [48, 57, 65, 90, 95, 95, 97, 122, 170, 170, 181, 181, 183, 183, 186, 186, 192, 214, 216, 246, 248, 705, 710, 721, 736, 740, 748, 748, 750, 750, 768, 884, 886, 887, 890, 893, 895, 895, 902, 906, 908, 908, 910, 929, 931, 1013, 1015, 1153, 1155, 1159, 1162, 1327, 1329, 1366, 1369, 1369, 1376, 1416, 1425, 1469, 1471, 1471, 1473, 1474, 1476, 1477, 1479, 1479, 1488, 1514, 1519, 1522, 1552, 1562, 1568, 1641, 1646, 1747, 1749, 1756, 1759, 1768, 1770, 1788, 1791, 1791, 1808, 1866, 1869, 1969, 1984, 2037, 2042, 2042, 2045, 2045, 2048, 2093, 2112, 2139, 2144, 2154, 2208, 2228, 2230, 2237, 2259, 2273, 2275, 2403, 2406, 2415, 2417, 2435, 2437, 2444, 2447, 2448, 2451, 2472, 2474, 2480, 2482, 2482, 2486, 2489, 2492, 2500, 2503, 2504, 2507, 2510, 2519, 2519, 2524, 2525, 2527, 2531, 2534, 2545, 2556, 2556, 2558, 2558, 2561, 2563, 2565, 2570, 2575, 2576, 2579, 2600, 2602, 2608, 2610, 2611, 2613, 2614, 2616, 2617, 2620, 2620, 2622, 2626, 2631, 2632, 2635, 2637, 2641, 2641, 2649, 2652, 2654, 2654, 2662, 2677, 2689, 2691, 2693, 2701, 2703, 2705, 2707, 2728, 2730, 2736, 2738, 2739, 2741, 2745, 2748, 2757, 2759, 2761, 2763, 2765, 2768, 2768, 2784, 2787, 2790, 2799, 2809, 2815, 2817, 2819, 2821, 2828, 2831, 2832, 2835, 2856, 2858, 2864, 2866, 2867, 2869, 2873, 2876, 2884, 2887, 2888, 2891, 2893, 2902, 2903, 2908, 2909, 2911, 2915, 2918, 2927, 2929, 2929, 2946, 2947, 2949, 2954, 2958, 2960, 2962, 2965, 2969, 2970, 2972, 2972, 2974, 2975, 2979, 2980, 2984, 2986, 2990, 3001, 3006, 3010, 3014, 3016, 3018, 3021, 3024, 3024, 3031, 3031, 3046, 3055, 3072, 3084, 3086, 3088, 3090, 3112, 3114, 3129, 3133, 3140, 3142, 3144, 3146, 3149, 3157, 3158, 3160, 3162, 3168, 3171, 3174, 3183, 3200, 3203, 3205, 3212, 3214, 3216, 3218, 3240, 3242, 3251, 3253, 3257, 3260, 3268, 3270, 3272, 3274, 3277, 3285, 3286, 3294, 3294, 3296, 3299, 3302, 3311, 3313, 3314, 3328, 3331, 3333, 3340, 3342, 3344, 3346, 3396, 3398, 3400, 3402, 3406, 3412, 3415, 3423, 3427, 3430, 3439, 3450, 3455, 3458, 3459, 3461, 3478, 3482, 3505, 3507, 3515, 3517, 3517, 3520, 3526, 3530, 3530, 3535, 3540, 3542, 3542, 3544, 3551, 3558, 3567, 3570, 3571, 3585, 3642, 3648, 3662, 3664, 3673, 3713, 3714, 3716, 3716, 3718, 3722, 3724, 3747, 3749, 3749, 3751, 3773, 3776, 3780, 3782, 3782, 3784, 3789, 3792, 3801, 3804, 3807, 3840, 3840, 3864, 3865, 3872, 3881, 3893, 3893, 3895, 3895, 3897, 3897, 3902, 3911, 3913, 3948, 3953, 3972, 3974, 3991, 3993, 4028, 4038, 4038, 4096, 4169, 4176, 4253, 4256, 4293, 4295, 4295, 4301, 4301, 4304, 4346, 4348, 4680, 4682, 4685, 4688, 4694, 4696, 4696, 4698, 4701, 4704, 4744, 4746, 4749, 4752, 4784, 4786, 4789, 4792, 4798, 4800, 4800, 4802, 4805, 4808, 4822, 4824, 4880, 4882, 4885, 4888, 4954, 4957, 4959, 4969, 4977, 4992, 5007, 5024, 5109, 5112, 5117, 5121, 5740, 5743, 5759, 5761, 5786, 5792, 5866, 5870, 5880, 5888, 5900, 5902, 5908, 5920, 5940, 5952, 5971, 5984, 5996, 5998, 6000, 6002, 6003, 6016, 6099, 6103, 6103, 6108, 6109, 6112, 6121, 6155, 6157, 6160, 6169, 6176, 6264, 6272, 6314, 6320, 6389, 6400, 6430, 6432, 6443, 6448, 6459, 6470, 6509, 6512, 6516, 6528, 6571, 6576, 6601, 6608, 6618, 6656, 6683, 6688, 6750, 6752, 6780, 6783, 6793, 6800, 6809, 6823, 6823, 6832, 6845, 6912, 6987, 6992, 7001, 7019, 7027, 7040, 7155, 7168, 7223, 7232, 7241, 7245, 7293, 7296, 7304, 7312, 7354, 7357, 7359, 7376, 7378, 7380, 7418, 7424, 7673, 7675, 7957, 7960, 7965, 7968, 8005, 8008, 8013, 8016, 8023, 8025, 8025, 8027, 8027, 8029, 8029, 8031, 8061, 8064, 8116, 8118, 8124, 8126, 8126, 8130, 8132, 8134, 8140, 8144, 8147, 8150, 8155, 8160, 8172, 8178, 8180, 8182, 8188, 8255, 8256, 8276, 8276, 8305, 8305, 8319, 8319, 8336, 8348, 8400, 8412, 8417, 8417, 8421, 8432, 8450, 8450, 8455, 8455, 8458, 8467, 8469, 8469, 8472, 8477, 8484, 8484, 8486, 8486, 8488, 8488, 8490, 8505, 8508, 8511, 8517, 8521, 8526, 8526, 8544, 8584, 11264, 11310, 11312, 11358, 11360, 11492, 11499, 11507, 11520, 11557, 11559, 11559, 11565, 11565, 11568, 11623, 11631, 11631, 11647, 11670, 11680, 11686, 11688, 11694, 11696, 11702, 11704, 11710, 11712, 11718, 11720, 11726, 11728, 11734, 11736, 11742, 11744, 11775, 12293, 12295, 12321, 12335, 12337, 12341, 12344, 12348, 12353, 12438, 12441, 12447, 12449, 12538, 12540, 12543, 12549, 12591, 12593, 12686, 12704, 12730, 12784, 12799, 13312, 19893, 19968, 40943, 40960, 42124, 42192, 42237, 42240, 42508, 42512, 42539, 42560, 42607, 42612, 42621, 42623, 42737, 42775, 42783, 42786, 42888, 42891, 42943, 42946, 42950, 42999, 43047, 43072, 43123, 43136, 43205, 43216, 43225, 43232, 43255, 43259, 43259, 43261, 43309, 43312, 43347, 43360, 43388, 43392, 43456, 43471, 43481, 43488, 43518, 43520, 43574, 43584, 43597, 43600, 43609, 43616, 43638, 43642, 43714, 43739, 43741, 43744, 43759, 43762, 43766, 43777, 43782, 43785, 43790, 43793, 43798, 43808, 43814, 43816, 43822, 43824, 43866, 43868, 43879, 43888, 44010, 44012, 44013, 44016, 44025, 44032, 55203, 55216, 55238, 55243, 55291, 63744, 64109, 64112, 64217, 64256, 64262, 64275, 64279, 64285, 64296, 64298, 64310, 64312, 64316, 64318, 64318, 64320, 64321, 64323, 64324, 64326, 64433, 64467, 64829, 64848, 64911, 64914, 64967, 65008, 65019, 65024, 65039, 65056, 65071, 65075, 65076, 65101, 65103, 65136, 65140, 65142, 65276, 65296, 65305, 65313, 65338, 65343, 65343, 65345, 65370, 65382, 65470, 65474, 65479, 65482, 65487, 65490, 65495, 65498, 65500, 65536, 65547, 65549, 65574, 65576, 65594, 65596, 65597, 65599, 65613, 65616, 65629, 65664, 65786, 65856, 65908, 66045, 66045, 66176, 66204, 66208, 66256, 66272, 66272, 66304, 66335, 66349, 66378, 66384, 66426, 66432, 66461, 66464, 66499, 66504, 66511, 66513, 66517, 66560, 66717, 66720, 66729, 66736, 66771, 66776, 66811, 66816, 66855, 66864, 66915, 67072, 67382, 67392, 67413, 67424, 67431, 67584, 67589, 67592, 67592, 67594, 67637, 67639, 67640, 67644, 67644, 67647, 67669, 67680, 67702, 67712, 67742, 67808, 67826, 67828, 67829, 67840, 67861, 67872, 67897, 67968, 68023, 68030, 68031, 68096, 68099, 68101, 68102, 68108, 68115, 68117, 68119, 68121, 68149, 68152, 68154, 68159, 68159, 68192, 68220, 68224, 68252, 68288, 68295, 68297, 68326, 68352, 68405, 68416, 68437, 68448, 68466, 68480, 68497, 68608, 68680, 68736, 68786, 68800, 68850, 68864, 68903, 68912, 68921, 69376, 69404, 69415, 69415, 69424, 69456, 69600, 69622, 69632, 69702, 69734, 69743, 69759, 69818, 69840, 69864, 69872, 69881, 69888, 69940, 69942, 69951, 69956, 69958, 69968, 70003, 70006, 70006, 70016, 70084, 70089, 70092, 70096, 70106, 70108, 70108, 70144, 70161, 70163, 70199, 70206, 70206, 70272, 70278, 70280, 70280, 70282, 70285, 70287, 70301, 70303, 70312, 70320, 70378, 70384, 70393, 70400, 70403, 70405, 70412, 70415, 70416, 70419, 70440, 70442, 70448, 70450, 70451, 70453, 70457, 70459, 70468, 70471, 70472, 70475, 70477, 70480, 70480, 70487, 70487, 70493, 70499, 70502, 70508, 70512, 70516, 70656, 70730, 70736, 70745, 70750, 70751, 70784, 70853, 70855, 70855, 70864, 70873, 71040, 71093, 71096, 71104, 71128, 71133, 71168, 71232, 71236, 71236, 71248, 71257, 71296, 71352, 71360, 71369, 71424, 71450, 71453, 71467, 71472, 71481, 71680, 71738, 71840, 71913, 71935, 71935, 72096, 72103, 72106, 72151, 72154, 72161, 72163, 72164, 72192, 72254, 72263, 72263, 72272, 72345, 72349, 72349, 72384, 72440, 72704, 72712, 72714, 72758, 72760, 72768, 72784, 72793, 72818, 72847, 72850, 72871, 72873, 72886, 72960, 72966, 72968, 72969, 72971, 73014, 73018, 73018, 73020, 73021, 73023, 73031, 73040, 73049, 73056, 73061, 73063, 73064, 73066, 73102, 73104, 73105, 73107, 73112, 73120, 73129, 73440, 73462, 73728, 74649, 74752, 74862, 74880, 75075, 77824, 78894, 82944, 83526, 92160, 92728, 92736, 92766, 92768, 92777, 92880, 92909, 92912, 92916, 92928, 92982, 92992, 92995, 93008, 93017, 93027, 93047, 93053, 93071, 93760, 93823, 93952, 94026, 94031, 94087, 94095, 94111, 94176, 94177, 94179, 94179, 94208, 100343, 100352, 101106, 110592, 110878, 110928, 110930, 110948, 110951, 110960, 111355, 113664, 113770, 113776, 113788, 113792, 113800, 113808, 113817, 113821, 113822, 119141, 119145, 119149, 119154, 119163, 119170, 119173, 119179, 119210, 119213, 119362, 119364, 119808, 119892, 119894, 119964, 119966, 119967, 119970, 119970, 119973, 119974, 119977, 119980, 119982, 119993, 119995, 119995, 119997, 120003, 120005, 120069, 120071, 120074, 120077, 120084, 120086, 120092, 120094, 120121, 120123, 120126, 120128, 120132, 120134, 120134, 120138, 120144, 120146, 120485, 120488, 120512, 120514, 120538, 120540, 120570, 120572, 120596, 120598, 120628, 120630, 120654, 120656, 120686, 120688, 120712, 120714, 120744, 120746, 120770, 120772, 120779, 120782, 120831, 121344, 121398, 121403, 121452, 121461, 121461, 121476, 121476, 121499, 121503, 121505, 121519, 122880, 122886, 122888, 122904, 122907, 122913, 122915, 122916, 122918, 122922, 123136, 123180, 123184, 123197, 123200, 123209, 123214, 123214, 123584, 123641, 124928, 125124, 125136, 125142, 125184, 125259, 125264, 125273, 126464, 126467, 126469, 126495, 126497, 126498, 126500, 126500, 126503, 126503, 126505, 126514, 126516, 126519, 126521, 126521, 126523, 126523, 126530, 126530, 126535, 126535, 126537, 126537, 126539, 126539, 126541, 126543, 126545, 126546, 126548, 126548, 126551, 126551, 126553, 126553, 126555, 126555, 126557, 126557, 126559, 126559, 126561, 126562, 126564, 126564, 126567, 126570, 126572, 126578, 126580, 126583, 126585, 126588, 126590, 126590, 126592, 126601, 126603, 126619, 126625, 126627, 126629, 126633, 126635, 126651, 131072, 173782, 173824, 177972, 177984, 178205, 178208, 183969, 183984, 191456, 194560, 195101, 917760, 917999];
//     \\/**
//     \\* Test for whether a single line comment with leading whitespace trimmed's text contains a directive.
//     \\*/
//     \\var commentDirectiveRegExSingleLine = /^\/\/\/?\s*@(ts-expect-error|ts-ignore)/;
//     \\/**
//     \\* Test for whether a multi-line comment with leading whitespace trimmed's last line contains a directive.
//     \\*/
//     \\var commentDirectiveRegExMultiLine = /^(?:\/|\*)*\s*@(ts-expect-error|ts-ignore)/;
//     \\    /** @deprecated Use `factory.updateTaggedTemplate` or the factory supplied by your transformation context instead. */
//     \\    ts.updateTaggedTemplate = ts.Debug.deprecate(function updateTaggedTemplate(node, tag, typeArgumentsOrTemplate, template) {
//     \\        var typeArguments;
//     \\        if (template) {
//     \\            typeArguments = typeArgumentsOrTemplate;
//     \\        }
//     \\        else {
//     \\            template = typeArgumentsOrTemplate;
//     \\        }
//     \\        return ts.factory.updateTaggedTemplateExpression(node, tag, typeArguments, template);
//     \\    }, factoryDeprecation);
//     \\    /** @deprecated Use `factory.updateBinary` or the factory supplied by your transformation context instead. */
//     \\    ts.updateBinary = ts.Debug.deprecate(function updateBinary(node, left, right, operator) {
//     \\        if (operator === void 0) { operator = node.operatorToken; }
//     \\        if (typeof operator === "number") {
//     \\            operator = operator === node.operatorToken.kind ? node.operatorToken : ts.factory.createToken(operator);
//     \\        }
//     \\        return ts.factory.updateBinaryExpression(node, left, operator, right);
//     \\    }, factoryDeprecation);
//     \\    /** @deprecated Use `factory.createConditional` or the factory supplied by your transformation context instead. */
//     \\    ts.createConditional = ts.Debug.deprecate(function createConditional(condition, questionTokenOrWhenTrue, whenTrueOrWhenFalse, colonToken, whenFalse) {
//     \\        return arguments.length === 5 ? ts.factory.createCondit 🤎💬 💭 🗯 ♠️ ♣️ ♥️ ♦️ 🃏 🎴 🀄️ 🕐 🕑 🕒 🕓 🕔 🕕 🕖 🕗 🕘 🕙 🕚 🕛 🕜 🕝 ionalExpression(condition, questionTokenOrWhenTrue, whenTrueOrWhenFalse, colonToken, whenFalse) :
//     \\            arguments.length === 3 ? ts.factory.createConditionalExpression(condition, ts.factory.createToken(57 /* QuestionToken */), questionTokenOrWhenTrue, ts.factory.createToken(58 /* ColonToken */), whenTrueOrWhenFalse) :
//     \\                ts.Debug.fail("Argument count mismatch");
//     \\    }, factoryDeprecation);
//     \\    /** @deprecated Use `factory.createYield` or the factory supplied by your transformation context instead. */
//     \\    ts.createYield = ts.Debug.deprecate(function createYield(asteriskTokenOrExpression, expression) {
//     \\        var asteriskToken;
//     \\        if (expression) {
//     \\            asteriskToken = asteriskTokenOrExpression;
//     \\        }
//     \\        else {
//     \\            expression = asteriskTokenOrExpression;
//     \\        }
//     \\        return ts.factory.createYieldExpre 🤎💬 💭 🗯 ♠️ ♣️ ♥️ ♦️ 🃏 🎴 🀄️ 🕐 🕑 🕒 🕓 🕔 🕕 🕖 🕗 🕘 🕙 🕚 🕛 🕜 🕝 ssion(asteriskToken, expression);
//     \\    }, factoryDeprecation);
//     \\    /** @deprecated Use `factory.createClassExpression` or the factory supplied by your transformation context instead. */
//     \\    ts.createClassExpression = ts.Debug.deprecate(function createClassExpression(modifiers, name, typeParameters, heritageClauses, members) {
//     \\        return ts.factory.createClassExpression(/*decorators*/ undefined, modifiers, name, typeParameters, heritageClauses, members);
//     \\    }, factoryDeprecation); 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️
//     \\    /** @deprecated Use `factory.updateClassExpression` or the factory supplied by your transformation context instead. */
//     \\    ts.updateClassExpression = ts.Debug.deprecate(function updateClassExpression(node, modifiers, name, typeParameters, heritageClauses, members) {
//     \\        return ts.factory.updateClassExpression(node, /*decorato 🤎💬 💭 🗯 ♠️ ♣️ ♥️ ♦️ 🃏 🎴 🀄️ 🕐 🕑 🕒 🕓 🕔 🕕 🕖 🕗 🕘 🕙 🕚 🕛 🕜 🕝 rs*/ undefined, modifiers, name, typeParameters, heritageClauses, members);
//     \\    }, factoryDeprecation);
//     \\    /** @deprecated Use `factory.createPropertySignature` or the factory supplied by your transformation context instead. */
//     \\    ts.createPropertySignature = ts.Debug.deprecate(function createPropertySignature(modifiers, name, questionToken, type, initializer) {
//     \\        var node = ts.factory.createPropertySignature(modifiers, name, questionToken, type);
//     \\        node.initializer = initializer;
//     \\        return node;
//     \\    }, factoryDeprecation);
//     \\    /** @deprecated Use `factory.updatePropertySignature` or the factory supplied by your transformation context instead. */
//     \\    ts.updatePropertySignature = ts.Debug.deprecate(function updatePropertySignature(node, modifiers, name, questionToken, type, initializer) {
//     \\        var updated = ts.factory.updatePropertySignature(node, modifiers, name, questionToken, type);
//     \\        if (node.initia 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 👁‍🗨 💬 💭 🗯 ♠️ ♣️ ♥️ ♦️ 🃏 🎴 🀄️ 🕐 🕑 🕒 🕓 🕔 🕕 🕖 🕗 🕘 🕙 🕚 🕛 🕜 🕝 🕞 lizer !== initializer) {
//     \\            if (updated === node) {
//     \\                updated = ts 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 👁‍🗨 💬 💭 🗯 ♠️ ♣️ ♥️ ♦️ 🃏 🎴 🀄️ 🕐 🕑 🕒 🕓 🕔 🕕 🕖 🕗 🕘 🕙 🕚 🕛 🕜 🕝 🕞 .factory.cloneNode(node);
//     \\            }
//     \\            updated.ini ` 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 👁‍🗨 💬 💭 🗯 ♠️ ♣️ ♥️ ♦️ 🃏 🎴 🀄️ 🕐 🕑 🕒 🕓 🕔 🕕 🕖 🕗 🕘 🕙 🕚 🕛 🕜 🕝 🕞 tializer = initializer;
//     \\        }
//     \\        return updated;⏏ ♀  💚 💙 💜 🖤 🤍 🤎📢 👁‍🗨 💬 💭 🗯 ♠️ ♣️ ♥️ ♦️ 🃏 🎴 🀄️ 🕐 🕑 🕒 🕓 🕔 🕕 🕖 🕗 🕘 🕙 🕚 🕛 🕜 🕝 🕞 ♂ ⚕ ♾️
//     \\    }, factoryDeprecation 💛 💚 💙 💜 🖤 🤍🕞  💛⏏ ♀ ♂ ⚕ ♾️
//     \\    /** @deprecated Use⏏ ♀  💚 💙 💜 🖤 🤍 🤎📢 👁‍🗨 💬 💭 🗯 ♠️ ♣️ ♥️ ♦️ 🃏 🎴 🀄️ 🕐 🕑 🕒 🕓 🕔 🕕 🕖 🕗 🕘 🕙 🕚 🕛 🕜 🕝 🕞 ♂ ⚕ ♾️
//     \\    ts.createExpression ` 💛 💚 💙 💜 🖤 🤍 🤎💭 🗯 ♠️ ♣️ ♥️ ♦️ 🃏 🎴 🀄️ 🕐 🕑 🕒 🕓 🕔 🕕 🕖 🕗 🕘 🕙 🕚 🕛 🕜 🕝 🕞 Wi 💛⏏ ♀ ♂ ⚕ ♾️
//     \\        return ts.factory⏏  💚 💙 💜 🖤 🤍 🤎 👁‍🗨 💬 💭 🗯 ♠️ ♣️ ♥️ ♦️ 🃏 🎴 🀄️ 🕐 🕑 🕒 🕓 🕔 🕕 🕖 🕗 🕘 🕙 🕚 🕛 🕜 🕝 🕞 ♀ ♂ ⚕ ♾️
//     \\    }, factoryDeprecation 💛⏏ ♀ ♂ ⚕ ♾️
//     \\    /** @deprecated Use⏏ ♀ ♂ ⚕ ♾️
//     \\    ts.updateExpressionWi 💛⏏ ♀ ♂ ⚕ ♾️
//     \\    }, factoryDeprecation);👨🏿‍🎤 👩🏿‍🏫 👨🏿‍🏫 👩🏿‍🏭 👨🏿‍🏭 👩🏿‍💻 👨🏿‍💻 👩🏿‍💼 👨🏿‍💼 👩🏿‍🔧 👨🏿‍🔧 👩🏿‍🔬 👨🏿‍🔬 👩🏿‍🎨 👨🏿‍🎨 👩🏿‍🚒 👨🏿‍🚒 👩🏿‍✈️ 👨🏿‍✈️ 👩🏿‍🚀 👨🏿‍🚀 👩🏿‍⚖️ 👨🏿‍⚖️ 🤶🏿 🎅🏿 👸🏿 🤴🏿 👰🏿 🤵🏿 👼🏿 🤰🏿 🙇🏿‍♀️ 🙇🏿 💁🏿 💁🏿‍♂️ 🙅🏿 🙅🏿‍♂️ 🙆🏿 🙆🏿‍♂️ 🙋🏿 🙋🏿‍♂️ 🤦🏿‍♀️ 🤦🏿‍♂️ 🤷🏿‍♀️ 🤷🏿‍♂️ 🙎🏿 🙎🏿‍♂️ 🙍🏿 🙍🏿‍♂️ 💇🏿 💇🏿‍♂️ 💆🏿 💆🏿‍♂️ 🕴🏿 💃🏿 🕺🏿 🚶🏿‍♀️ 🚶🏿 🏃🏿‍♀️ 🏃🏿 🏋🏿‍♀️ 🏋🏿 🤸🏿‍♀️ 🤸🏿‍♂️ ⛹🏿‍♀️ ⛹🏿 🤾🏿‍♀️ 🤾🏿‍♂️ 🏌🏿‍♀️ 🏌🏿 🏄🏿‍♀️ 🏄🏿 🏊🏿‍♀️ 🏊🏿 🤽🏿‍♀️ 🤽🏿‍♂️ 🚣🏿‍♀️ 🚣🏿 🏇🏿 🚴🏿‍♀️ 🚴🏿 🚵🏿‍♀️ 🚵🏿 🤹🏿‍♀️ 🤹🏿‍♂️ 🛀🏿 🧒🏿 🧑🏿 🧓🏿 🧕🏿 🧔🏿 🤱🏿 🧙🏿‍♀️ 🧙🏿‍♂️ 🧚🏿‍♀️ 🧚🏿‍♂️ 🧛🏿‍♀️ 🧛🏿‍♂️ 🧜🏿‍♀️ 🧜🏿‍♂️ 🧝🏿‍♀️ 🧝🏿‍♂️ 🧖🏿‍♀️ 🧖🏿‍♂️ 🧗🏿‍♀️ 🧗🏿‍♂️ 🧘🏿‍♀️ 🧘🏿‍♂️ 🤟🏿 🤲🏿 💏🏿 💑🏿 🤏🏿 🦻🏿 🧏🏿 🧏🏿‍♂️ 🧏🏿‍♀️ 🧍🏿 🧍🏿‍♂️ 🧍🏿‍♀️ 🧎🏿 🧎🏿‍♂️ 🧎🏿‍♀️ 👨🏿‍🦯 👩🏿‍🦯 👨🏿‍🦼 👩🏿‍🦼 👨🏿‍🦽 👩🏿‍🦽 🧑🏿‍🤝‍🧑🏿 🧑🏿‍🦰 🧑🏿‍🦱 🧑🏿‍🦳 🧑🏿‍🦲 🧑🏿‍⚕️ 🧑🏿‍🎓 🧑🏿‍🏫 🧑🏿‍⚖️ 🧑🏿‍🌾 🧑🏿‍🍳 🧑🏿‍🔧 🧑🏿‍🏭 🧑🏿‍💼 🧑🏿‍🔬 🧑🏿‍💻 🧑🏿‍🎤 🧑🏿‍🎨 🧑🏿‍✈️ 🧑🏿‍🚀 🧑🏿‍🚒 🧑🏿‍🦯 🧑🏿‍🦼 🧑🏿‍🦽
//     \\    /** @deprecated Use `factory.createArrowFunction` or the factory supplied by your transformation context instead. */👨🏿‍🎤 👩🏿‍🏫 👨🏿‍🏫 👩🏿‍🏭 👨🏿‍🏭 👩🏿‍💻 👨🏿‍💻 👩🏿‍💼 👨🏿‍💼 👩🏿‍🔧 👨🏿‍🔧 👩🏿‍🔬 👨🏿‍🔬 👩🏿‍🎨 👨🏿‍🎨 👩🏿‍🚒 👨🏿‍🚒 👩🏿‍✈️ 👨🏿‍✈️ 👩🏿‍🚀 👨🏿‍🚀 👩🏿‍⚖️ 👨🏿‍⚖️ 🤶🏿 🎅🏿 👸🏿 🤴🏿 👰🏿 🤵🏿 👼🏿 🤰🏿 🙇🏿‍♀️ 🙇🏿 💁🏿 💁🏿‍♂️ 🙅🏿 🙅🏿‍♂️ 🙆🏿 🙆🏿‍♂️ 🙋🏿 🙋🏿‍♂️ 🤦🏿‍♀️ 🤦🏿‍♂️ 🤷🏿‍♀️ 🤷🏿‍♂️ 🙎🏿 🙎🏿‍♂️ 🙍🏿 🙍🏿‍♂️ 💇🏿 💇🏿‍♂️ 💆🏿 💆🏿‍♂️ 🕴🏿 💃🏿 🕺🏿 🚶🏿‍♀️ 🚶🏿 🏃🏿‍♀️ 🏃🏿 🏋🏿‍♀️ 🏋🏿 🤸🏿‍♀️ 🤸🏿‍♂️ ⛹🏿‍♀️ ⛹🏿 🤾🏿‍♀️ 🤾🏿‍♂️ 🏌🏿‍♀️ 🏌🏿 🏄🏿‍♀️ 🏄🏿 🏊🏿‍♀️ 🏊🏿 🤽🏿‍♀️ 🤽🏿‍♂️ 🚣🏿‍♀️ 🚣🏿 🏇🏿 🚴🏿‍♀️ 🚴🏿 🚵🏿‍♀️ 🚵🏿 🤹🏿‍♀️ 🤹🏿‍♂️ 🛀🏿 🧒🏿 🧑🏿 🧓🏿 🧕🏿 🧔🏿 🤱🏿 🧙🏿‍♀️ 🧙🏿‍♂️ 🧚🏿‍♀️ 🧚🏿‍♂️ 🧛🏿‍♀️ 🧛🏿‍♂️ 🧜🏿‍♀️ 🧜🏿‍♂️ 🧝🏿‍♀️ 🧝🏿‍♂️ 🧖🏿‍♀️ 🧖🏿‍♂️ 🧗🏿‍♀️ 🧗🏿‍♂️ 🧘🏿‍♀️ 🧘🏿‍♂️ 🤟🏿 🤲🏿 💏🏿 💑🏿 🤏🏿 🦻🏿 🧏🏿 🧏🏿‍♂️ 🧏🏿‍♀️ 🧍🏿 🧍🏿‍♂️ 🧍🏿‍♀️ 🧎🏿 🧎🏿‍♂️ 🧎🏿‍♀️ 👨🏿‍🦯 👩🏿‍🦯 👨🏿‍🦼 👩🏿‍🦼 👨🏿‍🦽 👩🏿‍🦽 🧑🏿‍🤝‍🧑🏿 🧑🏿‍🦰 🧑🏿‍🦱 🧑🏿‍🦳 🧑🏿‍🦲 🧑🏿‍⚕️ 🧑🏿‍🎓 🧑🏿‍🏫 🧑🏿‍⚖️ 🧑🏿‍🌾 🧑🏿‍🍳 🧑🏿‍🔧 🧑🏿‍🏭 🧑🏿‍💼 🧑🏿‍🔬 🧑🏿‍💻 🧑🏿‍🎤 🧑🏿‍🎨 🧑🏿‍✈️ 🧑🏿‍🚀 🧑🏿‍🚒 🧑🏿‍🦯 🧑🏿‍🦼 🧑🏿‍🦽
//     \\    ts.createArrowFunction = ts.Debug.deprecate(function createArrowFunction(modifiers, typeParameters, parameters, type, equalsGreaterThanTokenOrBody, body) {
//     \\        return arguments.length === 6 ? ts.factory.createArrowFunction(modifiers, typeParameters, parameters, type, equalsGreaterThanTokenOrBody, body) :
//     \\            arguments.length === 5 ? ts.factory.createA 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣
//     \\ 💔 ❣️ 💕 ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 👁‍🗨
//     \\ 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣
//     \\ 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 👁‍🗨 💬
//     \\💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 rrowFunction(modifiers, typeParamete👨🏿‍🎤 👩🏿‍🏫 👨🏿‍🏫 👩🏿‍🏭 👨🏿‍🏭 👩🏿‍💻 👨🏿‍💻 👩🏿‍💼 👨🏿‍💼 👩🏿‍🔧 👨🏿‍🔧 👩🏿‍🔬 👨🏿‍🔬 👩🏿‍🎨 👨🏿‍🎨 👩🏿‍🚒 👨🏿‍🚒 👩🏿‍✈️ 👨🏿‍✈️ 👩🏿‍🚀 👨🏿‍🚀 👩🏿‍⚖️ 👨🏿‍⚖️ 🤶🏿 🎅🏿 👸🏿 🤴🏿 👰🏿 🤵🏿 👼🏿 🤰🏿 🙇🏿‍♀️ 🙇🏿 💁🏿 💁🏿‍♂️ 🙅🏿 🙅🏿‍♂️ 🙆🏿 🙆🏿‍♂️ 🙋🏿 🙋🏿‍♂️ 🤦🏿‍♀️ 🤦🏿‍♂️ 🤷🏿‍♀️ 🤷🏿‍♂️ 🙎🏿 🙎🏿‍♂️ 🙍🏿 🙍🏿‍♂️ 💇🏿 💇🏿‍♂️ 💆🏿 💆🏿‍♂️ 🕴🏿 💃🏿 🕺🏿 🚶🏿‍♀️ 🚶🏿 🏃🏿‍♀️ 🏃🏿 🏋🏿‍♀️ 🏋🏿 🤸🏿‍♀️ 🤸🏿‍♂️ ⛹🏿‍♀️ ⛹🏿 🤾🏿‍♀️ 🤾🏿‍♂️ 🏌🏿‍♀️ 🏌🏿 🏄🏿‍♀️ 🏄🏿 🏊🏿‍♀️ 🏊🏿 🤽🏿‍♀️ 🤽🏿‍♂️ 🚣🏿‍♀️ 🚣🏿 🏇🏿 🚴🏿‍♀️ 🚴🏿 🚵🏿‍♀️ 🚵🏿 🤹🏿‍♀️ 🤹🏿‍♂️ 🛀🏿 🧒🏿 🧑🏿 🧓🏿 🧕🏿 🧔🏿 🤱🏿 🧙🏿‍♀️ 🧙🏿‍♂️ 🧚🏿‍♀️ 🧚🏿‍♂️ 🧛🏿‍♀️ 🧛🏿‍♂️ 🧜🏿‍♀️ 🧜🏿‍♂️ 🧝🏿‍♀️ 🧝🏿‍♂️ 🧖🏿‍♀️ 🧖🏿‍♂️ 🧗🏿‍♀️ 🧗🏿‍♂️ 🧘🏿‍♀️ 🧘🏿‍♂️ 🤟🏿 🤲🏿 💏🏿 💑🏿 🤏🏿 🦻🏿 🧏🏿 🧏🏿‍♂️ 🧏🏿‍♀️ 🧍🏿 🧍🏿‍♂️ 🧍🏿‍♀️ 🧎🏿 🧎🏿‍♂️ 🧎🏿‍♀️ 👨🏿‍🦯 👩🏿‍🦯 👨🏿‍🦼 👩🏿‍🦼 👨🏿‍🦽 👩🏿‍🦽 🧑🏿‍🤝‍🧑🏿 🧑🏿‍🦰 🧑🏿‍🦱 🧑🏿‍🦳 🧑🏿‍🦲 🧑🏿‍⚕️ 🧑🏿‍🎓 🧑🏿‍🏫 🧑🏿‍⚖️ 🧑🏿‍🌾 🧑🏿‍🍳 🧑🏿‍🔧 🧑🏿‍🏭 🧑🏿‍💼 🧑🏿‍🔬 🧑🏿‍💻 🧑🏿‍🎤 🧑🏿‍🎨 🧑🏿‍✈️ 🧑🏿‍🚀 🧑🏿‍🚒 🧑🏿‍🦯 🧑🏿‍🦼 🧑🏿‍🦽
//     \\    }, factoryDeprecation); 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣
//     \\ 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 👁‍🗨
//     \\ 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣
//     \\ 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 👁‍🗨 💬
//     \\💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢
//     \\    /** @deprecated Use `factory.updateArrowFunction` o 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣
//     \\ 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 👁‍🗨
//     \\ 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ 🐱‍👤 🐱‍🚀 🐱‍🐉 🐱‍💻 🐱‍🏍 ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣
//     \\ 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 👁‍🗨 💬
//     \\💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 r the factory supplied by your transformation context instead. */
//     \\    ts.updateArrowFunction = ts.Debug.deprecate(functio 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣
//     \\ 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 👁‍🗨
//     \\ 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣
//     \\ 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 👁‍🗨 💬
//     \\💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 n updateArrowFunction(node, modifiers, typeParameters, parameters, type, equalsGreaterThanTokenOrBody, body) {
//     \\        return arguments.length === 7 ? ts.factory.upda 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣
//     \\ 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 👁‍🗨
//     \\ 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣
//     \\ 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 👁‍🗨 💬
//     \\💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 teArrowFunction(node, modifiers, typeParameters, parameters, type, equalsGreaterThanTokenOrBody, body) :
//     \\            arguments.length === 6 ? ts.factory.updateA 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣
//     \\ 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 👁‍🗨
//     \\ 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣
//     \\ 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 👁‍🗨 💬
//     \\💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 rrowFunction(node, modifiers, typeParameters, parameters, type, node.equalsGreaterThanToken, equalsGreaterThanTokenOrBody) :
//     \\                ts.Debug.fail("Argument count mismatch" 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣
//     \\ 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 👁‍🗨
//     \\ 💔 ❣️ 💕 💞 💓
//     \\ 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 👁‍🗨 💬
//     \\💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 );👨🏿‍🎤 👩🏿‍🏫 👨🏿‍🏫 👩🏿‍🏭 👨🏿‍🏭 👩🏿‍💻 👨🏿‍💻 👩🏿‍💼 👨🏿‍💼 👩🏿‍🔧 👨🏿‍🔧 👩🏿‍🔬 👨🏿‍🔬 👩🏿‍🎨 👨🏿‍🎨 👩🏿‍🚒 👨🏿‍🚒 👩🏿‍✈️ 👨🏿‍✈️ 👩🏿‍🚀 👨🏿‍🚀 👩🏿‍⚖️ 👨🏿‍⚖️ 🤶🏿 🎅🏿 👸🏿 🤴🏿 👰🏿 🤵🏿 👼🏿 🤰🏿 🙇🏿‍♀️ 🙇🏿 💁🏿 💁🏿‍♂️ 🙅🏿 🙅🏿‍♂️ 🙆🏿 🙆🏿‍♂️ 🙋🏿 🙋🏿‍♂️ 🤦🏿‍♀️ 🤦🏿‍♂️ 🤷🏿‍♀️ 🤷🏿‍♂️ 🙎🏿 🙎🏿‍♂️ 🙍🏿 🙍🏿‍♂️ 💇🏿 💇🏿‍♂️ 💆🏿 💆🏿‍♂️ 🕴🏿 💃🏿 🕺🏿 🚶🏿‍♀️ 🚶🏿 🏃🏿‍♀️ 🏃🏿 🏋🏿‍♀️ 🏋🏿 🤸🏿‍♀️ 🤸🏿‍♂️ ⛹🏿‍♀️ ⛹🏿 🤾🏿‍♀️ 🤾🏿‍♂️ 🏌🏿‍♀️ 🏌🏿 🏄🏿‍♀️ 🏄🏿 🏊🏿‍♀️ 🏊🏿 🤽🏿‍♀️ 🤽🏿‍♂️ 🚣🏿‍♀️ 🚣🏿 🏇🏿 🚴🏿‍♀️ 🚴🏿 🚵🏿‍♀️ 🚵🏿 🤹🏿‍♀️ 🤹🏿‍♂️ 🛀🏿 🧒🏿 🧑🏿 🧓🏿 🧕🏿 🧔🏿 🤱🏿 🧙🏿‍♀️ 🧙🏿‍♂️ 🧚🏿‍♀️ 🧚🏿‍♂️ 🧛🏿‍♀️ 🧛🏿‍♂️ 🧜🏿‍♀️ 🧜🏿‍♂️ 🧝🏿‍♀️ 🧝🏿‍♂️ 🧖🏿‍♀️ 🧖🏿‍♂️ 🧗🏿‍♀️ 🧗🏿‍♂️ 🧘🏿‍♀️ 🧘🏿‍♂️ 🤟🏿 🤲🏿 💏🏿 💑🏿 🤏🏿 🦻🏿 🧏🏿 🧏🏿‍♂️ 🧏🏿‍♀️ 🧍🏿 🧍🏿‍♂️ 🧍🏿‍♀️ 🧎🏿 🧎🏿‍♂️ 🧎🏿‍♀️ 👨🏿‍🦯 👩🏿‍🦯 👨🏿‍🦼 👩🏿‍🦼 👨🏿‍🦽 👩🏿‍🦽 🧑🏿‍🤝‍🧑🏿 🧑🏿‍🦰 🧑🏿‍🦱 🧑🏿‍🦳 🧑🏿‍🦲 🧑🏿‍⚕️ 🧑🏿‍🎓 🧑🏿‍🏫 🧑🏿‍⚖️ 🧑🏿‍🌾 🧑🏿‍🍳 🧑🏿‍🔧 🧑🏿‍🏭 🧑🏿‍💼 🧑🏿‍🔬 🧑🏿‍💻 🧑🏿‍🎤 🧑🏿‍🎨 🧑🏿‍✈️ 🧑🏿‍🚀 🧑🏿‍🚒 🧑🏿‍🦯 🧑🏿‍🦼 🧑🏿‍🦽eDeclaration(name, exclamationTokenOrType, typeOrInitializer, initializer) {
//     \\        return arguments.length === 4 ? ts.factory.createVariableDeclaration(name, exclamationTokenOrType, typeOrInitializer, initializer) :👨🏿‍🎤 👩🏿‍🏫 👨🏿‍🏫 👩🏿‍🏭 👨🏿‍🏭 👩🏿‍💻 👨🏿‍💻 👩🏿‍💼 👨🏿‍💼 👩🏿‍🔧 👨🏿‍🔧 👩🏿‍🔬 👨🏿‍🔬 👩🏿‍🎨 👨🏿‍🎨 👩🏿‍🚒 👨🏿‍🚒 👩🏿‍✈️ 👨🏿‍✈️ 👩🏿‍🚀 👨🏿‍🚀 👩🏿‍⚖️ 👨🏿‍⚖️ 🤶🏿 🎅🏿 👸🏿 🤴🏿 👰🏿 🤵🏿 👼🏿 🤰🏿 🙇🏿‍♀️ 🙇🏿 💁🏿 💁🏿‍♂️ 🙅🏿 🙅🏿‍♂️ 🙆🏿 🙆🏿‍♂️ 🙋🏿 🙋🏿‍♂️ 🤦🏿‍♀️ 🤦🏿‍♂️ 🤷🏿‍♀️ 🤷🏿‍♂️ 🙎🏿 🙎🏿‍♂️ 🙍🏿 🙍🏿‍♂️ 💇🏿 💇🏿‍♂️ 💆🏿 💆🏿‍♂️ 🕴🏿 💃🏿 🕺🏿 🚶🏿‍♀️ 🚶🏿 🏃🏿‍♀️ 🏃🏿 🏋🏿‍♀️ 🏋🏿 🤸🏿‍♀️ 🤸🏿‍♂️ ⛹🏿‍♀️ ⛹🏿 🤾🏿‍♀️ 🤾🏿‍♂️ 🏌🏿‍♀️ 🏌🏿 🏄🏿‍♀️ 🏄🏿 🏊🏿‍♀️ 🏊🏿 🤽🏿‍♀️ 🤽🏿‍♂️ 🚣🏿‍♀️ 🚣🏿 🏇🏿 🚴🏿‍♀️ 🚴🏿 🚵🏿‍♀️ 🚵🏿 🤹🏿‍♀️ 🤹🏿‍♂️ 🛀🏿 🧒🏿 🧑🏿 🧓🏿 🧕🏿 🧔🏿 🤱🏿 🧙🏿‍♀️ 🧙🏿‍♂️ 🧚🏿‍♀️ 🧚🏿‍♂️ 🧛🏿‍♀️ 🧛🏿‍♂️ 🧜🏿‍♀️ 🧜🏿‍♂️ 🧝🏿‍♀️ 🧝🏿‍♂️ 🧖🏿‍♀️ 🧖🏿‍♂️ 🧗🏿‍♀️ 🧗🏿‍♂️ 🧘🏿‍♀️ 🧘🏿‍♂️ 🤟🏿 🤲🏿 💏🏿 💑🏿 🤏🏿 🦻🏿 🧏🏿 🧏🏿‍♂️ 🧏🏿‍♀️ 🧍🏿 🧍🏿‍♂️ 🧍🏿‍♀️ 🧎🏿 🧎🏿‍♂️ 🧎🏿‍♀️ 👨🏿‍🦯 👩🏿‍🦯 👨🏿‍🦼 👩🏿‍🦼 👨🏿‍🦽 👩🏿‍🦽 🧑🏿‍🤝‍🧑🏿 🧑🏿‍🦰 🧑🏿‍🦱 🧑🏿‍🦳 🧑🏿‍🦲 🧑🏿‍⚕️ 🧑🏿‍🎓 🧑🏿‍🏫 🧑🏿‍⚖️ 🧑🏿‍🌾 🧑🏿‍🍳 🧑🏿‍🔧 🧑🏿‍🏭 🧑🏿‍💼 🧑🏿‍🔬 🧑🏿‍💻 🧑🏿‍🎤 🧑🏿‍🎨 🧑🏿‍✈️ 🧑🏿‍🚀 🧑🏿‍🚒 🧑🏿‍🦯 🧑🏿‍🦼 🧑🏿‍🦽
//     \\            argu💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 ments.length >= 1 && arguments.length <= 3 ? ts.factory.createVariableDeclaration(name, /*exclamationToken*/ undefined, exclamationTokenOrType, typeOrInitializer) :
//     \\                ts.Debug.fail("Argument count mismatch");👨🏿‍🎤 👩🏿‍🏫 👨🏿‍🏫 👩🏿‍🏭 👨🏿‍🏭 👩🏿‍💻 👨🏿‍💻 👩🏿‍💼 👨🏿‍💼 👩🏿‍🔧 👨🏿‍🔧 👩🏿‍🔬 👨🏿‍🔬 👩🏿‍🎨 👨🏿‍🎨 👩🏿‍🚒 👨🏿‍🚒 👩🏿‍✈️ 👨🏿‍✈️ 👩🏿‍🚀 👨🏿‍🚀 👩🏿‍⚖️ 👨🏿‍⚖️ 🤶🏿 🎅🏿 👸🏿 🤴🏿 👰🏿 🤵🏿 👼🏿 🤰🏿 🙇🏿‍♀️ 🙇🏿 💁🏿 💁🏿‍♂️ 🙅🏿 🙅🏿‍♂️ 🙆🏿 🙆🏿‍♂️ 🙋🏿 🙋🏿‍♂️ 🤦🏿‍♀️ 🤦🏿‍♂️ 🤷🏿‍♀️ 🤷🏿‍♂️ 🙎🏿 🙎🏿‍♂️ 🙍🏿 🙍🏿‍♂️ 💇🏿 💇🏿‍♂️ 💆🏿 💆🏿‍♂️ 🕴🏿 💃🏿 🕺🏿 🚶🏿‍♀️ 🚶🏿 🏃🏿‍♀️ 🏃🏿 🏋🏿‍♀️ 🏋🏿 🤸🏿‍♀️ 🤸🏿‍♂️ ⛹🏿‍♀️ ⛹🏿 🤾🏿‍♀️ 🤾🏿‍♂️ 🏌🏿‍♀️ 🏌🏿 🏄🏿‍♀️ 🏄🏿 🏊🏿‍♀️ 🏊🏿 🤽🏿‍♀️ 🤽🏿‍♂️ 🚣🏿‍♀️ 🚣🏿 🏇🏿 🚴🏿‍♀️ 🚴🏿 🚵🏿‍♀️ 🚵🏿 🤹🏿‍♀️ 🤹🏿‍♂️ 🛀🏿 🧒🏿 🧑🏿 🧓🏿 🧕🏿 🧔🏿 🤱🏿 🧙🏿‍♀️ 🧙🏿‍♂️ 🧚🏿‍♀️ 🧚🏿‍♂️ 🧛🏿‍♀️ 🧛🏿‍♂️ 🧜🏿‍♀️ 🧜🏿‍♂️ 🧝🏿‍♀️ 🧝🏿‍♂️ 🧖🏿‍♀️ 🧖🏿‍♂️ 🧗🏿‍♀️ 🧗🏿‍♂️ 🧘🏿‍♀️ 🧘🏿‍♂️ 🤟🏿 🤲🏿 💏🏿 💑🏿 🤏🏿 🦻🏿 🧏🏿 🧏🏿‍♂️ 🧏🏿‍♀️ 🧍🏿 🧍🏿‍♂️ 🧍🏿‍♀️ 🧎🏿 🧎🏿‍♂️ 🧎🏿‍♀️ 👨🏿‍🦯 👩🏿‍🦯 👨🏿‍🦼 👩🏿‍🦼 👨🏿‍🦽 👩🏿‍🦽 🧑🏿‍🤝‍🧑🏿 🧑🏿‍🦰 🧑🏿‍🦱 🧑🏿‍🦳 🧑🏿‍🦲 🧑🏿‍⚕️ 🧑🏿‍🎓 🧑🏿‍🏫 🧑🏿‍⚖️ 🧑🏿‍🌾 🧑🏿‍🍳 🧑🏿‍🔧 🧑🏿‍🏭 🧑🏿‍💼 🧑🏿‍🔬 🧑🏿‍💻 🧑🏿‍🎤 🧑🏿‍🎨 🧑🏿‍✈️ 🧑🏿‍🚀 🧑🏿‍🚒 🧑🏿‍🦯 🧑🏿‍🦼 🧑🏿‍🦽
//     \\    }, factoryDeprecation);
//     \\    /** @deprecated Use `factory.updateVariableDeclaration` or the factory supplied by your transformation context instead. */👨🏿‍🎤 👩🏿‍🏫 👨🏿‍🏫 👩🏿‍🏭 👨🏿‍🏭 👩🏿‍💻 👨🏿‍💻 👩🏿‍💼 👨🏿‍💼 👩🏿‍🔧 👨🏿‍🔧 👩🏿‍🔬 👨🏿‍🔬 👩🏿‍🎨 👨🏿‍🎨 👩🏿‍🚒 👨🏿‍🚒 👩🏿‍✈️ 👨🏿‍✈️ 👩🏿‍🚀 👨🏿‍🚀 👩🏿‍⚖️ 👨🏿‍⚖️ 🤶🏿 🎅🏿 👸🏿 🤴🏿 👰🏿 🤵🏿 👼🏿 🤰🏿 🙇🏿‍♀️ 🙇🏿 💁🏿 💁🏿‍♂️ 🙅🏿 🙅🏿‍♂️ 🙆🏿 🙆🏿‍♂️ 🙋🏿 🙋🏿‍♂️ 🤦🏿‍♀️ 🤦🏿‍♂️ 🤷🏿‍♀️ 🤷🏿‍♂️ 🙎🏿 🙎🏿‍♂️ 🙍🏿 🙍🏿‍♂️ 💇🏿 💇🏿‍♂️ 💆🏿 💆🏿‍♂️ 🕴🏿 💃🏿 🕺🏿 🚶🏿‍♀️ 🚶🏿 🏃🏿‍♀️ 🏃🏿 🏋🏿‍♀️ 🏋🏿 🤸🏿‍♀️ 🤸🏿‍♂️ ⛹🏿‍♀️ ⛹🏿 🤾🏿‍♀️ 🤾🏿‍♂️ 🏌🏿‍♀️ 🏌🏿 🏄🏿‍♀️ 🏄🏿 🏊🏿‍♀️ 🏊🏿 🤽🏿‍♀️ 🤽🏿‍♂️ 🚣🏿‍♀️ 🚣🏿 🏇🏿 🚴🏿‍♀️ 🚴🏿 🚵🏿‍♀️ 🚵🏿 🤹🏿‍♀️ 🤹🏿‍♂️ 🛀🏿 🧒🏿 🧑🏿 🧓🏿 🧕🏿 🧔🏿 🤱🏿 🧙🏿‍♀️ 🧙🏿‍♂️ 🧚🏿‍♀️ 🧚🏿‍♂️ 🧛🏿‍♀️ 🧛🏿‍♂️ 🧜🏿‍♀️ 🧜🏿‍♂️ 🧝🏿‍♀️ 🧝🏿‍♂️ 🧖🏿‍♀️ 🧖🏿‍♂️ 🧗🏿‍♀️ 🧗🏿‍♂️ 🧘🏿‍♀️ 🧘🏿‍♂️ 🤟🏿 🤲🏿 💏🏿 💑🏿 🤏🏿 🦻🏿 🧏🏿 🧏🏿‍♂️ 🧏🏿‍♀️ 🧍🏿 🧍🏿‍♂️ 🧍🏿‍♀️ 🧎🏿 🧎🏿‍♂️ 🧎🏿‍♀️ 👨🏿‍🦯 👩🏿‍🦯 👨🏿‍🦼 👩🏿‍🦼 👨🏿‍🦽 👩🏿‍🦽 🧑🏿‍🤝‍🧑🏿 🧑🏿‍🦰 🧑🏿‍🦱 🧑🏿‍🦳 🧑🏿‍🦲 🧑🏿‍⚕️ 🧑🏿‍🎓 🧑🏿‍🏫 🧑🏿‍⚖️ 🧑🏿‍🌾 🧑🏿‍🍳 🧑🏿‍🔧 🧑🏿‍🏭 🧑🏿‍💼 🧑🏿‍🔬 🧑🏿‍💻 🧑🏿‍🎤 🧑🏿‍🎨 🧑🏿‍✈️ 🧑🏿‍🚀 🧑🏿‍🚒 🧑🏿‍🦯 🧑🏿‍🦼 🧑🏿‍🦽
//     \\        return arguments.length === 5 ? ts.factory.updateVariableDeclaration(node, name, exclamationTokenOrType, typeOrInitializer, initializer) :
//     \\            arguments.length === 4 ? ts.factory.updateVariableDeclaration(node, name, node.exclamationToken, exclamationTokenOrType, typeOrInitializer) :👨🏿‍🎤 👩🏿‍🏫 👨🏿‍🏫 👩🏿‍🏭 👨🏿‍🏭 👩🏿‍💻 👨🏿‍💻 👩🏿‍💼 👨🏿‍💼 👩🏿‍🔧 👨🏿‍🔧 👩🏿‍🔬 👨🏿‍🔬 👩🏿‍🎨 👨🏿‍🎨 👩🏿‍🚒 👨🏿‍🚒 👩🏿‍✈️ 👨🏿‍✈️ 👩🏿‍🚀 👨🏿‍🚀 👩🏿‍⚖️ 👨🏿‍⚖️ 🤶🏿 🎅🏿 👸🏿 🤴🏿 👰🏿 🤵🏿 👼🏿 🤰🏿 🙇🏿‍♀️ 🙇🏿 💁🏿 💁🏿‍♂️ 🙅🏿 🙅🏿‍♂️ 🙆🏿 🙆🏿‍♂️ 🙋🏿 🙋🏿‍♂️ 🤦🏿‍♀️ 🤦🏿‍♂️ 🤷🏿‍♀️ 🤷🏿‍♂️ 🙎🏿 🙎🏿‍♂️ 🙍🏿 🙍🏿‍♂️ 💇🏿 💇🏿‍♂️ 💆🏿 💆🏿‍♂️ 🕴🏿 💃🏿 🕺🏿 🚶🏿‍♀️ 🚶🏿 🏃🏿‍♀️ 🏃🏿 🏋🏿‍♀️ 🏋🏿 🤸🏿‍♀️ 🤸🏿‍♂️ ⛹🏿‍♀️ ⛹🏿 🤾🏿‍♀️ 🤾🏿‍♂️ 🏌🏿‍♀️ 🏌🏿 🏄🏿‍♀️ 🏄🏿 🏊🏿‍♀️ 🏊🏿 🤽🏿‍♀️ 🤽🏿‍♂️ 🚣🏿‍♀️ 🚣🏿 🏇🏿 🚴🏿‍♀️ 🚴🏿 🚵🏿‍♀️ 🚵🏿 🤹🏿‍♀️ 🤹🏿‍♂️ 🛀🏿 🧒🏿 🧑🏿 🧓🏿 🧕🏿 🧔🏿 🤱🏿 🧙🏿‍♀️ 🧙🏿‍♂️ 🧚🏿‍♀️ 🧚🏿‍♂️ 🧛🏿‍♀️ 🧛🏿‍♂️ 🧜🏿‍♀️ 🧜🏿‍♂️ 🧝🏿‍♀️ 🧝🏿‍♂️ 🧖🏿‍♀️ 🧖🏿‍♂️ 🧗🏿‍♀️ 🧗🏿‍♂️ 🧘🏿‍♀️ 🧘🏿‍♂️ 🤟🏿 🤲🏿 💏🏿 💑🏿 🤏🏿 🦻🏿 🧏🏿 🧏🏿‍♂️ 🧏🏿‍♀️ 🧍🏿 🧍🏿‍♂️ 🧍🏿‍♀️ 🧎🏿 🧎🏿‍♂️ 🧎🏿‍♀️ 👨🏿‍🦯 👩🏿‍🦯 👨🏿‍🦼 👩🏿‍🦼 👨🏿‍🦽 👩🏿‍🦽 🧑🏿‍🤝‍🧑🏿 🧑🏿‍🦰 🧑🏿‍🦱 🧑🏿‍🦳 🧑🏿‍🦲 🧑🏿‍⚕️ 🧑🏿‍🎓 🧑🏿‍🏫 🧑🏿‍⚖️ 🧑🏿‍🌾 🧑🏿‍🍳 🧑🏿‍🔧 🧑🏿‍🏭 🧑🏿‍💼 🧑🏿‍🔬 🧑🏿‍💻 🧑🏿‍🎤 🧑🏿‍🎨 🧑🏿‍✈️ 🧑🏿‍🚀 🧑🏿‍🚒 🧑🏿‍🦯 🧑🏿‍🦼 🧑🏿‍🦽
//     \\                ts.Debug.fail("Argument count mismatch");
//     \\    }, factoryDeprecation);
//     \\    😀 😃 😄 😁 😆 🤩 😅 😂 🤣 ☺️ 😊 😇 🙂 🙃 😉 😌 😍 😘 😗 😙 😚 😋 🤪 😜 😝👨🏿‍🎤 👩🏿‍🏫 👨🏿‍🏫 👩🏿‍🏭 👨🏿‍🏭 👩🏿‍💻 👨🏿‍💻 👩🏿‍💼 👨🏿‍💼 👩🏿‍🔧 👨🏿‍🔧 👩🏿‍🔬 👨🏿‍🔬 👩🏿‍🎨 👨🏿‍🎨 👩🏿‍🚒 👨🏿‍🚒 👩🏿‍✈️ 👨🏿‍✈️ 👩🏿‍🚀 👨🏿‍🚀 👩🏿‍⚖️ 👨🏿‍⚖️ 🤶🏿 🎅🏿 👸🏿 🤴🏿 👰🏿 🤵🏿 👼🏿 🤰🏿 🙇🏿‍♀️ 🙇🏿 💁🏿 💁🏿‍♂️ 🙅🏿 🙅🏿‍♂️ 🙆🏿 🙆🏿‍♂️ 🙋🏿 🙋🏿‍♂️ 🤦🏿‍♀️ 🤦🏿‍♂️ 🤷🏿‍♀️ 🤷🏿‍♂️ 🙎🏿 🙎🏿‍♂️ 🙍🏿 🙍🏿‍♂️ 💇🏿 💇🏿‍♂️ 💆🏿 💆🏿‍♂️ 🕴🏿 💃🏿 🕺🏿 🚶🏿‍♀️ 🚶🏿 🏃🏿‍♀️ 🏃🏿 🏋🏿‍♀️ 🏋🏿 🤸🏿‍♀️ 🤸🏿‍♂️ ⛹🏿‍♀️ ⛹🏿 🤾🏿‍♀️ 🤾🏿‍♂️ 🏌🏿‍♀️ 🏌🏿 🏄🏿‍♀️ 🏄🏿 🏊🏿‍♀️ 🏊🏿 🤽🏿‍♀️ 🤽🏿‍♂️ 🚣🏿‍♀️ 🚣🏿 🏇🏿 🚴🏿‍♀️ 🚴🏿 🚵🏿‍♀️ 🚵🏿 🤹🏿‍♀️ 🤹🏿‍♂️ 🛀🏿 🧒🏿 🧑🏿 🧓🏿 🧕🏿 🧔🏿 🤱🏿 🧙🏿‍♀️ 🧙🏿‍♂️ 🧚🏿‍♀️ 🧚🏿‍♂️ 🧛🏿‍♀️ 🧛🏿‍♂️ 🧜🏿‍♀️ 🧜🏿‍♂️ 🧝🏿‍♀️ 🧝🏿‍♂️ 🧖🏿‍♀️ 🧖🏿‍♂️ 🧗🏿‍♀️ 🧗🏿‍♂️ 🧘🏿‍♀️ 🧘🏿‍♂️ 🤟🏿 🤲🏿 💏🏿 💑🏿 🤏🏿 🦻🏿 🧏🏿 🧏🏿‍♂️ 🧏🏿‍♀️ 🧍🏿 🧍🏿‍♂️ 🧍🏿‍♀️ 🧎🏿 🧎🏿‍♂️ 🧎🏿‍♀️ 👨🏿‍🦯 👩🏿‍🦯 👨🏿‍🦼 👩🏿‍🦼 👨🏿‍🦽 👩🏿‍🦽 🧑🏿‍🤝‍🧑🏿 🧑🏿‍🦰 🧑🏿‍🦱 🧑🏿‍🦳 🧑🏿‍🦲 🧑🏿‍⚕️ 🧑🏿‍🎓 🧑🏿‍🏫 🧑🏿‍⚖️ 🧑🏿‍🌾 🧑🏿‍🍳 🧑🏿‍🔧 🧑🏿‍🏭 🧑🏿‍💼 🧑🏿‍🔬 🧑🏿‍💻 🧑🏿‍🎤 🧑🏿‍🎨 🧑🏿‍✈️ 🧑🏿‍🚀 🧑🏿‍🚒 🧑🏿‍🦯 🧑🏿‍🦼 🧑🏿‍🦽😛 🤑 🤗 🤓 😎 🤡 🤠 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 😤 😠 😡 🤬 😶 😐 😑 😯 😦 😧 😮 😲 😵 🤯 😳 😱 😨 😰 😢 😥 🤤 😭 😓 😪 😴 🥱 🙄 🤨 🧐 🤔 🤫 🤭 🤥 😬 🤐 🤢 🤮 🤧 😷 🤒 🤕 😈 👿 👹 👺 💩 👻 💀 ☠️ 👽 👾 🤖 🎃 😺 😸 😹 😻 😼 😽 🙀 😿 😾 👐 🙌 👏 🙏 🤲 🤝 👍 👎 👊 ✊ 🤛 🤜 🤞 ✌️ 🤘 🤏 👌 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐 🖖 👋 🤙 💪 🖕 🤟 ✍️ 🤳 💅 🖖 💄 💋 👄 👅 👂 🦻 👃 🦵 🦶 🦾 🦿 👣 👁 👀 🗣 👤 👥 👶 👦 👧 🧒 👨 👩 🧑 👱‍♀️ 👱 🧔 👴 👵 🧓 👲 👳‍♀️ 👳 🧕 👮‍♀️ 👮 👷‍♀️ 👷 💂‍♀️ 💂 🕵️‍♀️ 🕵️ 👩‍⚕️ 👨‍⚕️ 👩‍🌾 👨‍🌾 👩‍🍳 👨‍🍳 👩‍🎓 👨‍🎓 👩‍🎤 👨‍🎤 👩‍🏫 👨‍🏫 👩‍🏭 👨‍🏭 👩‍💻 👨‍💻 👩‍💼 👨‍💼 👩‍🔧 👨‍🔧 👩‍🔬 👨‍🔬 👩‍🎨 👨‍🎨 👩‍🚒 👨‍🚒 👩‍✈️ 👨‍✈️ 👩‍🚀 👨‍🚀 👩‍⚖️ 👨‍⚖️ 🤶 🎅 👸 🤴 👰 🤵 👼 🤰 🤱 🙇‍♀️ 🙇 💁 💁‍♂️ 🙅 🙅‍♂️ 🙆 🙆‍♂️ 🙋 🙋‍♂️ 🤦‍♀️ 🤦‍♂️ 🤷‍♀️ 🤷‍♂️ 🙎 🙎‍♂️ 🙍 🙍‍♂️ 💇 💇‍♂️ 💆 💆‍♂️ 🧖‍♀️ 🧖‍♂️ 🧏 🧏‍♂️ 🧏‍♀️ 🧙‍♀️ 🧙‍♂️ 🧛‍♀️ 🧛‍♂️ 🧟‍♀️ 🧟‍♂️ 🧚‍♀️ 🧚‍♂️ 🧜‍♀️ 🧜‍♂️ 🧝‍♀️ 🧝‍♂️ 🧞‍♀️ 🧞‍♂️ 🕴 💃 🕺 👯 👯‍♂️ 🚶‍♀️ 🚶 🏃‍♀️ 🏃 🧍 🧍‍♂️ 🧍‍♀️ 🧎 🧎‍♂️ 🧎‍♀️ 👨‍🦯 👩‍🦯 👨‍🦼 👩‍🦼 👨‍🦽 👩‍🦽 🧑‍🤝‍🧑 👫 👭 👬 💑 👩‍❤️‍👩 👨‍❤️‍👨 💏 👩‍❤️‍💋‍👩 👨‍❤️‍💋‍👨 👪 👨‍👩‍👧 👨‍👩‍👧‍👦 👨‍👩‍👦‍👦 👨‍👩‍👧‍👧 👩‍👩‍👦 👩‍👩‍👧 👩‍👩‍👧‍👦 👩‍👩‍👦‍👦 👩‍👩‍👧‍👧 👨‍👨‍👦 👨‍👨‍👧 👨‍👨‍👧‍👦 👨‍👨‍👦‍👦 👨‍👨‍👧‍👧 👩‍👦 👩‍👧 👩‍👧‍👦 👩‍👦‍👦 👩‍👧‍👧 👨‍👦 👨‍👧 👨‍👧‍👦 👨‍👦‍👦 👨‍👧‍👧 👚 👕 👖 👔 👗 👙 👘 👠 👡 👢 👞 👟 👒 🎩 🎓 👑 ⛑ 🎒 👝 👛 👜 💼 👓 🕶 🤿 🌂 ☂️ 🧣 🧤 🧥 🦺 🥻 🩱 🩲 🩳 🩰 🧦 🧢 ⛷ 🏂 🏋️‍♀️ 🏋️ 🤺 🤼‍♀️ 🤼‍♂️ 🤸‍♀️ 🤸‍♂️ ⛹️‍♀️ ⛹️ 🤾‍♀️ 🤾‍♂️ 🏌️‍♀️ 🏌️ 🏄‍♀️ 🏄 🏊‍♀️ 🏊 🤽‍♀️ 🤽‍♂️ 🚣‍♀️ 🚣 🏇 🚴‍♀️ 🚴 🚵‍♀️ 🚵 🤹‍♀️ 🤹‍♂️ 🧗‍♀️ 🧗‍♂️ 🧘‍♀️ 🧘‍♂️ 🥰 🥵 🥶 🥳 🥴 🥺 🦸 🦹 🧑‍🦰 🧑‍🦱 🧑‍🦳 🧑‍🦲 🧑‍⚕️ 🧑‍🎓 🧑‍🏫 🧑‍⚖️ 🧑‍🌾 🧑‍🍳 🧑‍🔧 🧑‍🏭 🧑‍💼 🧑‍🔬 🧑‍💻 🧑‍🎤 🧑‍🎨 🧑‍✈️ 🧑‍🚀 🧑‍🚒 🧑‍🦯 🧑‍🦼 🧑‍🦽 🦰 🦱 🦲 🦳
//     \\    /** @deprecated Use `factory.createImportClause` or the factory supplied by your transformation context instead. */
//     \\    ts.createImportClause = ts.Debug.deprecate(function createImportClause(name, namedBindings, isTypeOnly) {👨🏿‍🎤 👩🏿‍🏫 👨🏿‍🏫 👩🏿‍🏭 👨🏿‍🏭 👩🏿‍💻 👨🏿‍💻 👩🏿‍💼 👨🏿‍💼 👩🏿‍🔧 👨🏿‍🔧 👩🏿‍🔬 👨🏿‍🔬 👩🏿‍🎨 👨🏿‍🎨 👩🏿‍🚒 👨🏿‍🚒 👩🏿‍✈️ 👨🏿‍✈️ 👩🏿‍🚀 👨🏿‍🚀 👩🏿‍⚖️ 👨🏿‍⚖️ 🤶🏿 🎅🏿 👸🏿 🤴🏿 👰🏿 🤵🏿 👼🏿 🤰🏿 🙇🏿‍♀️ 🙇🏿 💁🏿 💁🏿‍♂️ 🙅🏿 🙅🏿‍♂️ 🙆🏿 🙆🏿‍♂️ 🙋🏿 🙋🏿‍♂️ 🤦🏿‍♀️ 🤦🏿‍♂️ 🤷🏿‍♀️ 🤷🏿‍♂️ 🙎🏿 🙎🏿‍♂️ 🙍🏿 🙍🏿‍♂️ 💇🏿 💇🏿‍♂️ 💆🏿 💆🏿‍♂️ 🕴🏿 💃🏿 🕺🏿 🚶🏿‍♀️ 🚶🏿 🏃🏿‍♀️ 🏃🏿 🏋🏿‍♀️ 🏋🏿 🤸🏿‍♀️ 🤸🏿‍♂️ ⛹🏿‍♀️ ⛹🏿 🤾🏿‍♀️ 🤾🏿‍♂️ 🏌🏿‍♀️ 🏌🏿 🏄🏿‍♀️ 🏄🏿 🏊🏿‍♀️ 🏊🏿 🤽🏿‍♀️ 🤽🏿‍♂️ 🚣🏿‍♀️ 🚣🏿 🏇🏿 🚴🏿‍♀️ 🚴🏿 🚵🏿‍♀️ 🚵🏿 🤹🏿‍♀️ 🤹🏿‍♂️ 🛀🏿 🧒🏿 🧑🏿 🧓🏿 🧕🏿 🧔🏿 🤱🏿 🧙🏿‍♀️ 🧙🏿‍♂️ 🧚🏿‍♀️ 🧚🏿‍♂️ 🧛🏿‍♀️ 🧛🏿‍♂️ 🧜🏿‍♀️ 🧜🏿‍♂️ 🧝🏿‍♀️ 🧝🏿‍♂️ 🧖🏿‍♀️ 🧖🏿‍♂️ 🧗🏿‍♀️ 🧗🏿‍♂️ 🧘🏿‍♀️ 🧘🏿‍♂️ 🤟🏿 🤲🏿 💏🏿 💑🏿 🤏🏿 🦻🏿 🧏🏿 🧏🏿‍♂️ 🧏🏿‍♀️ 🧍🏿 🧍🏿‍♂️ 🧍🏿‍♀️ 🧎🏿 🧎🏿‍♂️ 🧎🏿‍♀️ 👨🏿‍🦯 👩🏿‍🦯 👨🏿‍🦼 👩🏿‍🦼 👨🏿‍🦽 👩🏿‍🦽 🧑🏿‍🤝‍🧑🏿 🧑🏿‍🦰 🧑🏿‍🦱 🧑🏿‍🦳 🧑🏿‍🦲 🧑🏿‍⚕️ 🧑🏿‍🎓 🧑🏿‍🏫 🧑🏿‍⚖️ 🧑🏿‍🌾 🧑🏿‍🍳 🧑🏿‍🔧 🧑🏿‍🏭 🧑🏿‍💼 🧑🏿‍🔬 🧑🏿‍💻 🧑🏿‍🎤 🧑🏿‍🎨 🧑🏿‍✈️ 🧑🏿‍🚀 🧑🏿‍🚒 🧑🏿‍🦯 🧑🏿‍🦼 🧑🏿‍🦽
//     \\        return ts.factory.createImportClause(isTypeOnly, name, namedBindings);
//     \\    }, factoryDeprecation);👨🏿‍🎤 👩🏿‍🏫 👨🏿‍🏫 👩🏿‍🏭 👨🏿‍🏭 👩🏿‍💻 👨🏿‍💻 👩🏿‍💼 👨🏿‍💼 👩🏿‍🔧 👨🏿‍🔧 👩🏿‍🔬 👨🏿‍🔬 👩🏿‍🎨 👨🏿‍🎨 👩🏿‍🚒 👨🏿‍🚒 👩🏿‍✈️ 👨🏿‍✈️ 👩🏿‍🚀 👨🏿‍🚀 👩🏿‍⚖️ 👨🏿‍⚖️ 🤶🏿 🎅🏿 👸🏿 🤴🏿 👰🏿 🤵🏿 👼🏿 🤰🏿 🙇🏿‍♀️ 🙇🏿 💁🏿👨🏿‍🎤 👩🏿‍🏫 👨🏿‍🏫 👩🏿‍🏭 👨🏿‍🏭 👩🏿‍💻 👨🏿‍💻 👩🏿‍💼 👨🏿‍💼 👩🏿‍🔧 👨🏿‍🔧 👩🏿‍🔬 👨🏿‍🔬 👩🏿‍🎨 👨🏿‍🎨 👩🏿‍🚒 👨🏿‍🚒 👩🏿‍✈️ 👨🏿‍✈️ 👩🏿‍🚀 👨🏿‍🚀 👩🏿‍⚖️ 👨🏿‍⚖️ 🤶🏿 🎅🏿 👸🏿 🤴🏿 👰🏿 🤵🏿 👼🏿 🤰🏿 🙇🏿‍♀️ 🙇🏿 💁🏿 💁🏿‍♂️ 🙅🏿 🙅🏿‍♂️ 🙆🏿 🙆🏿‍♂️ 🙋🏿 🙋🏿‍♂️ 🤦🏿‍♀️ 🤦🏿‍♂️ 🤷🏿‍♀️ 🤷🏿‍♂️ 🙎🏿 🙎🏿‍♂️ 🙍🏿 🙍🏿‍♂️ 💇🏿 💇🏿‍♂️ 💆🏿 💆🏿‍♂️ 🕴🏿 💃🏿 🕺🏿 🚶🏿‍♀️ 🚶🏿 🏃🏿‍♀️ 🏃🏿 🏋🏿‍♀️ 🏋🏿 🤸🏿‍♀️ 🤸🏿‍♂️ ⛹🏿‍♀️ ⛹🏿 🤾🏿‍♀️ 🤾🏿‍♂️ 🏌🏿‍♀️ 🏌🏿 🏄🏿‍♀️ 🏄🏿 🏊🏿‍♀️ 🏊🏿 🤽🏿‍♀️ 🤽🏿‍♂️ 🚣🏿‍♀️ 🚣🏿 🏇🏿 🚴🏿‍♀️ 🚴🏿 🚵🏿‍♀️ 🚵🏿 🤹🏿‍♀️ 🤹🏿‍♂️ 🛀🏿 🧒🏿 🧑🏿 🧓🏿 🧕🏿 🧔🏿 🤱🏿 🧙🏿‍♀️ 🧙🏿‍♂️ 🧚🏿‍♀️ 🧚🏿‍♂️ 🧛🏿‍♀️ 🧛🏿‍♂️ 🧜🏿‍♀️ 🧜🏿‍♂️ 🧝🏿‍♀️ 🧝🏿‍♂️ 🧖🏿‍♀️ 🧖🏿‍♂️ 🧗🏿‍♀️ 🧗🏿‍♂️ 🧘🏿‍♀️ 🧘🏿‍♂️ 🤟🏿 🤲🏿 💏🏿 💑🏿 🤏🏿 🦻🏿 🧏🏿 🧏🏿‍♂️ 🧏🏿‍♀️ 🧍🏿 🧍🏿‍♂️ 🧍🏿‍♀️ 🧎🏿 🧎🏿‍♂️ 🧎🏿‍♀️ 👨🏿‍🦯 👩🏿‍🦯 👨🏿‍🦼 👩🏿‍🦼 👨🏿‍🦽 👩🏿‍🦽 🧑🏿‍🤝‍🧑🏿 🧑🏿‍🦰 🧑🏿‍🦱 🧑🏿‍🦳 🧑🏿‍🦲 🧑🏿‍⚕️ 🧑🏿‍🎓 🧑🏿‍🏫 🧑🏿‍⚖️ 🧑🏿‍🌾 🧑🏿‍🍳 🧑🏿‍🔧 🧑🏿‍🏭 🧑🏿‍💼 🧑🏿‍🔬 🧑🏿‍💻 🧑🏿‍🎤 🧑🏿‍🎨 🧑🏿‍✈️ 🧑🏿‍🚀 🧑🏿‍🚒 🧑🏿‍🦯 🧑🏿‍🦼 🧑🏿‍🦽 💁🏿‍♂️ 🙅🏿 🙅🏿‍♂️ 🙆🏿 🙆🏿‍♂️ 🙋🏿 🙋🏿‍♂️ 🤦🏿‍♀️ 🤦🏿‍♂️ 🤷🏿‍♀️ 🤷🏿‍♂️ 🙎🏿 🙎🏿‍♂️ 🙍🏿 🙍🏿‍♂️ 💇🏿 💇🏿‍♂️ 💆🏿 💆🏿‍♂️ 🕴🏿 💃🏿 🕺🏿 🚶🏿‍♀️ 🚶🏿 🏃🏿‍♀️ 🏃🏿 🏋🏿‍♀️ 🏋🏿 🤸🏿‍♀️ 🤸🏿‍♂️ ⛹🏿‍♀️ ⛹🏿 🤾🏿‍♀️ 🤾🏿‍♂️ 🏌🏿‍♀️ 🏌🏿 🏄🏿‍♀️ 🏄🏿 🏊🏿‍♀️ 🏊🏿 🤽🏿‍♀️ 🤽🏿‍♂️ 🚣🏿‍♀️ 🚣🏿 🏇🏿 🚴🏿‍♀️ 🚴🏿 🚵🏿‍♀️ 🚵🏿 🤹🏿‍♀️ 🤹🏿‍♂️ 🛀🏿 🧒🏿 🧑🏿 🧓🏿 🧕🏿 🧔🏿 🤱🏿 🧙🏿‍♀️ 🧙🏿‍♂️ 🧚🏿‍♀️ 🧚🏿‍♂️ 🧛🏿‍♀️ 🧛🏿‍♂️ 🧜🏿‍♀️ 🧜🏿‍♂️ 🧝🏿‍♀️ 🧝🏿‍♂️ 🧖🏿‍♀️ 🧖🏿‍♂️ 🧗🏿‍♀️ 🧗🏿‍♂️ 🧘🏿‍♀️ 🧘🏿‍♂️ 🤟🏿 🤲🏿 💏🏿 💑🏿 🤏🏿 🦻🏿 🧏🏿 🧏🏿‍♂️ 🧏🏿‍♀️ 🧍🏿 🧍🏿‍♂️ 🧍🏿‍♀️ 🧎🏿 🧎🏿‍♂️ 🧎🏿‍♀️ 👨🏿‍🦯 👩🏿‍🦯 👨🏿‍🦼 👩🏿‍🦼 👨🏿‍🦽 👩🏿‍🦽 🧑🏿‍🤝‍🧑🏿 🧑🏿‍🦰 🧑🏿‍🦱 🧑🏿‍🦳 🧑🏿‍🦲 🧑🏿‍⚕️ 🧑🏿‍🎓 🧑🏿‍🏫 🧑🏿‍⚖️ 🧑🏿‍🌾 🧑🏿‍🍳 🧑🏿‍🔧 🧑🏿‍🏭 🧑🏿‍💼 🧑🏿‍🔬 🧑🏿‍💻 🧑🏿‍🎤 🧑🏿‍🎨 🧑🏿‍✈️ 🧑🏿‍🚀 🧑🏿‍🚒 🧑🏿‍🦯 🧑🏿‍🦼 🧑🏿‍🦽ry supplied by your transformation context instead. */
//     \\    ts.updateImportClause = ts.Debug.deprecate(function updateImportClause(node, name, namedBindings, isTypeOnly) {
//     \\        return ts.factory.updateImportClause(node, isTypeOnly, name, namedBindings);
//     \\    }, factoryDeprecation);👨🏿‍🎤 👩🏿‍🏫 👨🏿‍🏫 👩🏿‍🏭 👨🏿‍🏭 👩🏿‍💻 👨🏿‍💻 👩🏿‍💼 👨🏿‍💼 👩🏿‍🔧 👨🏿‍🔧 👩🏿‍🔬 👨🏿‍🔬 👩🏿‍🎨 👨🏿‍🎨 👩🏿‍🚒 👨🏿‍🚒 👩🏿‍✈️ 👨🏿‍✈️ 👩🏿‍🚀 👨🏿‍🚀 👩🏿‍⚖️ 👨🏿‍⚖️ 🤶🏿 🎅🏿 👸🏿 🤴🏿 👰🏿 🤵🏿 👼🏿 🤰🏿 🙇🏿‍♀️ 🙇🏿 💁🏿 💁🏿‍♂️ 🙅🏿 🙅🏿‍♂️ 🙆🏿 🙆🏿‍♂️ 🙋🏿 🙋🏿‍♂️ 🤦🏿‍♀️ 🤦🏿‍♂️ 🤷🏿‍♀️ 🤷🏿‍♂️ 🙎🏿 🙎🏿‍♂️ 🙍🏿 🙍🏿‍♂️ 💇🏿 💇🏿‍♂️ 💆🏿 💆🏿‍♂️ 🕴🏿 💃🏿 🕺🏿 🚶🏿‍♀️ 🚶🏿 🏃🏿‍♀️ 🏃🏿 🏋🏿‍♀️ 🏋🏿 🤸🏿‍♀️ 🤸🏿‍♂️ ⛹🏿‍♀️ ⛹🏿 🤾🏿‍♀️ 🤾🏿‍♂️ 🏌🏿‍♀️ 🏌🏿 🏄🏿‍♀️ 🏄🏿 🏊🏿‍♀️ 🏊🏿 🤽🏿‍♀️ 🤽🏿‍♂️ 🚣🏿‍♀️ 🚣🏿 🏇🏿 🚴🏿‍♀️ 🚴🏿 🚵🏿‍♀️ 🚵🏿 🤹🏿‍♀️ 🤹🏿‍♂️ 🛀🏿 🧒🏿 🧑🏿 🧓🏿 🧕🏿 🧔🏿 🤱🏿 🧙🏿‍♀️ 🧙🏿‍♂️ 🧚🏿‍♀️ 🧚🏿‍♂️ 🧛🏿‍♀️ 🧛🏿‍♂️ 🧜🏿‍♀️ 🧜🏿‍♂️ 🧝🏿‍♀️ 🧝🏿‍♂️ 🧖🏿‍♀️ 🧖🏿‍♂️ 🧗🏿‍♀️ 🧗🏿‍♂️ 🧘🏿‍♀️ 🧘🏿‍♂️ 🤟🏿 🤲🏿 💏🏿 💑🏿 🤏🏿 🦻🏿 🧏🏿 🧏🏿‍♂️ 🧏🏿‍♀️ 🧍🏿 🧍🏿‍♂️ 🧍🏿‍♀️ 🧎🏿 🧎🏿‍♂️ 🧎🏿‍♀️ 👨🏿‍🦯 👩🏿‍🦯 👨🏿‍🦼 👩🏿‍🦼 👨🏿‍🦽 👩🏿‍🦽 🧑🏿‍🤝‍🧑🏿 🧑🏿‍🦰 🧑🏿‍🦱 🧑🏿‍🦳 🧑🏿‍🦲 🧑🏿‍⚕️ 🧑🏿‍🎓 🧑🏿‍🏫 🧑🏿‍⚖️ 🧑🏿‍🌾 🧑🏿‍🍳 🧑🏿‍🔧 🧑🏿‍🏭 🧑🏿‍💼 🧑🏿‍🔬 🧑🏿‍💻 🧑🏿‍🎤 🧑🏿‍🎨 🧑🏿‍✈️ 🧑🏿‍🚀 🧑🏿‍🚒 🧑🏿‍🦯 🧑🏿‍🦼 🧑🏿‍🦽
//     \\    /** @deprecated Use `factory.createExportDeclaration` or the factory supplied by your transformation context instead. */👨🏿‍🎤 👩🏿‍🏫 👨🏿‍🏫 👩🏿‍🏭 👨🏿‍🏭 👩🏿‍💻 👨🏿‍💻 👩🏿‍💼 👨🏿‍💼 👩🏿‍🔧 👨🏿‍🔧 👩🏿‍🔬 👨🏿‍🔬 👩🏿‍🎨 👨🏿‍🎨 👩🏿‍🚒 👨🏿‍🚒 👩🏿‍✈️ 👨🏿‍✈️ 👩🏿‍🚀 👨🏿‍🚀 👩🏿‍⚖️ 👨🏿‍⚖️ 🤶🏿 🎅🏿 👸🏿 🤴🏿 👰🏿 🤵🏿 👼🏿 🤰🏿 🙇🏿‍♀️ 🙇🏿 💁🏿 💁🏿‍♂️ 🙅🏿 🙅🏿‍♂️ 🙆🏿 🙆🏿‍♂️ 🙋🏿 🙋🏿‍♂️ 🤦🏿‍♀️ 🤦🏿‍♂️ 🤷🏿‍♀️ 🤷🏿‍♂️ 🙎🏿 🙎🏿‍♂️ 🙍🏿 🙍🏿‍♂️ 💇🏿 💇🏿‍♂️ 💆🏿 💆🏿‍♂️ 🕴🏿 💃🏿 🕺🏿 🚶🏿‍♀️ 🚶🏿 🏃🏿‍♀️ 🏃🏿 🏋🏿‍♀️ 🏋🏿 🤸🏿‍♀️ 🤸🏿‍♂️ ⛹🏿‍♀️ ⛹🏿 🤾🏿‍♀️ 🤾🏿‍♂️ 🏌🏿‍♀️ 🏌🏿 🏄🏿‍♀️ 🏄🏿 🏊🏿‍♀️ 🏊🏿 🤽🏿‍♀️ 🤽🏿‍♂️ 🚣🏿‍♀️ 🚣🏿 🏇🏿 🚴🏿‍♀️ 🚴🏿 🚵🏿‍♀️ 🚵🏿 🤹🏿‍♀️ 🤹🏿‍♂️ 🛀🏿 🧒🏿 🧑🏿 🧓🏿 🧕🏿 🧔🏿 🤱🏿 🧙🏿‍♀️ 🧙🏿‍♂️ 🧚🏿‍♀️ 🧚🏿‍♂️ 🧛🏿‍♀️ 🧛🏿‍♂️ 🧜🏿‍♀️ 🧜🏿‍♂️ 🧝🏿‍♀️ 🧝🏿‍♂️ 🧖🏿‍♀️ 🧖🏿‍♂️ 🧗🏿‍♀️ 🧗🏿‍♂️ 🧘🏿‍♀️ 🧘🏿‍♂️ 🤟🏿 🤲🏿 💏🏿 💑🏿 🤏🏿 🦻🏿 🧏🏿 🧏🏿‍♂️ 🧏🏿‍♀️ 🧍🏿 🧍🏿‍♂️ 🧍🏿‍♀️ 🧎🏿 🧎🏿‍♂️ 🧎🏿‍♀️ 👨🏿‍🦯 👩🏿‍🦯 👨🏿‍🦼 👩🏿‍🦼 👨🏿‍🦽 👩🏿‍🦽 🧑🏿‍🤝‍🧑🏿 🧑🏿‍🦰 🧑🏿‍🦱 🧑🏿‍🦳 🧑🏿‍🦲 🧑🏿‍⚕️ 🧑🏿‍🎓 🧑🏿‍🏫 🧑🏿‍⚖️ 🧑🏿‍🌾 🧑🏿‍🍳 🧑🏿‍🔧 🧑🏿‍🏭 🧑🏿‍💼 🧑🏿‍🔬 🧑🏿‍💻 🧑🏿‍🎤 🧑🏿‍🎨 🧑🏿‍✈️ 🧑🏿‍🚀 🧑🏿‍🚒 🧑🏿‍🦯 🧑🏿‍🦼 🧑🏿‍🦽
//     \\    ts.createExportDeclaration = ts.Debug.deprecate(function createExportDeclaration(decorators, modifiers, exportClause, moduleSpecifier, isTypeOnly) {
//     \\        if (isTypeOnly === void 0) { isTypeOnly = false; }
//     \\        return ts.factory.createExportDeclaration(decorators, modifiers, isTypeOnly, exportClause, moduleSpecifier);😇 🙂 🙃 😉 😌 😍 😘 😗 😙 😚 😋 🤪 😜 😝 😛 🤑 🤗 🤓 😎 🤡 🤠 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 😤 😠 😡 🤬 😶 😐 😑 😯 😦 😧 😮 😲 😵 🤯 😳 😱 😨 😰 😢
//     \\    }, factoryDeprecation);
//     \\    /** @deprecated Use `factory.updateExportDeclaration` or the factory supplied by your transformation context instead. */
//     \\    ts.updateEx 🐱‍👤 🐱‍🚀 🐱‍🐉 🐱‍💻 🐱‍🏍portDeclaration = ts.Debug.deprecate(function updateExportDeclaration(node, decorators, modifiers, exportClause, moduleSpecifier, isTypeOnly) {
//     \\        return ts.factory.updateExportDeclaration(node, decorators, modifiers, isTypeOnly, exportClause, moduleSpecifier);
//     \\    }, factory 🐱‍👤 🐱‍🚀 🐱‍🐉 🐱‍💻 🐱‍🏍Deprecation);
//     \\    /** @deprecated Use `factory.createJSDocParameterTag` or the factory supplied by your transformation context instead. */
//     \\    ts.createJSDocPar 🐱‍👤 🐱‍🚀 🐱‍🐉 🐱‍💻 🐱‍🏍amTag = ts.Debug 🐱‍👤 🐱‍🚀 🐱‍🐉 🐱‍💻 🐱‍🏍.deprecate(function createJSDocParamTag(name, isBracketed, typeExpression, comment) {
//     \\        return ts.factory.createJSDocParameterTag(/*tagName*/ undefined, name, isBracketed, typeExpression, /*isNameFirst*/ false, comment ? ts.factory.createNodeArray([ts.factory.createJSDocText(comment)]) : undefivned);
//     \\    }, factoryDeprecation);
//     \\    /** @deprecated Use `factory.createComma` or the factory supplied by your transformation context instead. */
//     \\    ts.createComma = ts.Debug.deprecate(function createComma(left, right) {
//     \\        return ts.factory.createComma(left, right);
//     \\ 🐱‍👤 🐱‍🚀  🐱‍🐉 🐱‍💻 🐱‍🏍🐱‍🏍    }, factoryDeprecation);
//     \\    /** @deprecated  🐱‍👤 🐱‍🚀 🐱‍🐉 🐱‍💻 🐱‍🏍Use `factory.createLessThan` or the factory supplied by your transformation context instead. */
//     \\    ts.createLessThan = ts.Debug.deprecate(function createLessThan(left, right) {😇 🙂 🙃 😉 😌 😍 😘 😗 😙 😚 😋 🤪 😜 😝 😛 🤑 🤗 🤓 😎 🤡 🤠 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 😤 😠 😡 🤬 😶 😐 😑 😯 😦 😧 😮 😲 😵 🤯 😳 😱 😨 😰 😢
//     \\    }, factoryDeprecation);
//     \\    /** @ 🐱‍👤 🐱‍🚀 🐱‍🐉 🐱‍💻 🐱‍🏍deprecated Use `factory.createAssignment` or the factory supplied by your transformation context instead. */😇 🙂 🙃 😉 😌 😍 😘 😗 😙 😚 😋 🤪 😜 😝 😛 🤑 🤗 🤓 😎 🤡 🤠 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 😤 😠 😡 🤬 😶 😐 😑 😯 😦 😧 😮 😲 😵 🤯 😳 😱 😨 😰 😢
//     \\    /** @deprecated Use `factory.createStrictEquality` or the factory supplied by your transformation context instead. */
//     \\    ts.createStrictEquality = ts.Debug.dep 🐱‍👤 🐱‍🚀 🐱‍🐉 🐱‍💻 🐱‍🏍recate(function createStrictEquality(left, right) {
//     \\        return ts.factory.createStrictEquality(left, right);😇 🙂 🙃 😉 😌 😍 😘 😗 😙 😚 😋 🤪 😜 😝 😛 🤑 🤗 🤓 😎 🤡 🤠 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 😤 😠 😡 🤬 😶 😐 😑 😯 😦 😧 😮 😲 😵 🤯 😳 😱 😨 😰 😢😇 🙂 🙃 😉 😌 😍 😘 😗 😙 😚 😋 🤪 😜 😝 😛 🤑 🤗 🤓 😎 🤡 🤠 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 😤 😠 😡 🤬 😶 😐 😑 😯 😦 😧 😮 😲 😵 🤯 😳 😱 😨 😰 😢
//     \\    }, factoryDeprecation);
//     \\    /** @deprecated 🐱‍🐉 🐱‍💻  🐱‍👤 🐱‍🚀Use `factory.createStrictInequality` or the factory supplied by your transformation context instead. */
//     \\    ts.createStrictInequality = ts.Debug.deprecate(function createStrictInequality(left, right) {
//     \\        return ts.factory.createStrictInequality(left, right);
//     \\    }, factoryDeprecation);
//     \\    /** @deprecated Use `factory.createAdd` or the factory supplied b😇 🙂 🙃 😉 😌 😍 😘 😗 😙 😚 😋 🤪 😜 😝 😛 🤑 🤗 🤓 😎 🤡 🤠 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 😤 😠 😡 🤬 😶 😐 😑 😯 😦 😧 😮 😲 😵 🤯 😳 😱 😨 😰 😢
//     \\        return ts.factory.createSubtract(left, right);
//     \\    }, factoryDeprecation);
//     \\    /** @deprecated Use `factory.createLogicalAnd` or the factory supplied by your transformation context instead. */
//     \\    ts.createLogicalAnd = ts.Debug.deprecate(function createLogicalAnd(left, right) {
//     \\        return ts.factory.createLogicalAnd(left, right);😇 🙂 🙃 😉 😌 😍 😘 😗 😙 😚 😋 🤪 😜 😝 😛 🤑 🤗 🤓 😎 🤡 🤠 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 😤 😠 😡 🤬 😶 😐 😑 😯 😦 😧 😮 😲 😵 🤯 😳 😱 😨 😰 😢😇 🙂 🙃 😉 😌 😍 😘 😗 😙 😚 😋 🤪 😜 😝 😛 🤑 🤗 🤓 😎 🤡 🤠 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 😤 😠 😡 🤬 😶 😐 😑 😯 😦 😧 😮 😲 😵 🤯 😳 😱 😨 😰 😢
//     \\    }, factoryDeprecation);
//     \\    /** @deprecated Use `factory.createLogicalOr` or the factory supplied by your transformation context instead. */
//     \\    ts.createLogicalOr = ts.Debug.deprecate(function createLogicalOr(left, right) {😇 🙂 🙃 😉 😌 😍 😘 😗 😙 😚 😋 🤪 😜 😝 😛 🤑 🤗 🤓 😎 🤡 🤠 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 😤 😠 😡 🤬 😶 😐 😑 😯 😦 😧 😮 😲 😵 🤯 😳 😱 😨 😰 😢
//     \\        return ts.factory.createLogicalOr(left, right);😇 🙂 🙃 😉 😌 😍 😘 😗 😙 😚 😋 🤪 😜 😝 😛 🤑 🤗 🤓 😎 🤡 🤠 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 😤 😠 😡 🤬 😶 😐 😑 😯 😦 😧 😮 😲 😵 🤯 😳 😱 😨 😰 😢
//     \\    }, factoryDeprecation);😇 🙂 🙃 😉 😌 😍 😘 😗 😙 😚 😋 🤪 😜 😝 😛 🤑 🤗 🤓 😎 🤡 🤠 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 😤 😠 😡 🤬 😶 😐 😑 😯 😦 😧 😮 😲 😵 🤯 😳 😱 😨 😰 😢supplied by your transformation context instead. */
//     \\    ts.createPostfixIncrement = ts.Debug.deprecate(function createPostfixIncrement(operand) {😇 🙂 🙃 😉 😌 😍 😘 😗 😙 😚 😋 🤪 😜 😝 😛 🤑 🤗 🤓 😎 🤡 🤠 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 😤 😠 😡 🤬 😶 😐 😑 😯 😦 😧 😮 😲 😵 🤯 😳 😱 😨 😰 😢
//     \\        return ts.factory.createPostfixIncrement(operand);😇 🙂 🙃 😉 😌 😍 😘 😗 😙 😚 😋 🤪 😜 😝 😛 🤑 🤗 🤓 😎 🤡 🤠 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 😤 😠 😡 🤬 😶 😐 😑 😯 😦 😧 😮 😲 😵 🤯 😳 😱 😨 😰 😢
//     \\    }, factoryDeprecation);
//     \\    /** @deprecated Use an appropriate `factory` method instead. */
//     \\    ts.createNode = ts.Debug.deprecate(function createNode(kind, pos, end) {
//     \\        if (pos === void 0) { pos = 0; }😇 🙂 🙃 😉 😌 😍 😘 😗 😙 😚 😋 🤪 😜 😝 😛 🤑 🤗 🤓 😎 🤡 🤠 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 😤 😠 😡 🤬 😶 😐 😑 😯 😦 😧 😮 😲 😵 🤯 😳 😱 😨 😰 😢NodeFactory.createBaseSourceFileNode(kind) :
//     \\            kind === 79 /* Identifier */ ? ts.parseBaseNodeFactory.createBaseIdentifierNode(kind) :
//     \\                kind === 80 /* PrivateIdentifier */ ? ts.parseBaseNodeFactory.createBasePrivateIdentifierNode(kind) :
//     \\                    !ts.isNodeKind(kind) ? ts.parseBaseNodeFactory.createBaseTokenNode(kind) :😇 🙂 🙃 😉 😌 😍 😘 😗 😙 😚 😋 🤪 😜 😝 😛 🤑 🤗 🤓 😎 🤡 🤠 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 😤 😠 😡 🤬 😶 😐 😑 😯 😦 😧 😮 😲 😵 🤯 😳 😱 😨 😰 😢a node ~for mutation~ with its `pos`, `end`, and `parent` set.
//     \\     *
//     \\     * NOTE: It is unsafe to change any properties of a `Node` that relate to its AST children, as those changes won't be
//     \\     * captured with respect to transformations.
//     \\     *
//     \\     * @deprecated Use an appropriate `factory.update...` method instead, use `setCommentRange` or `setSourceMapRange`, and avoid setting `parent`.😇 🙂 🙃 😉 😌 😍 😘 😗 😙 😚 😋 🤪 😜 😝 😛 🤑 🤗 🤓 😎 🤡 🤠 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 😤 😠 😡 🤬 😶 😐 😑 😯 😦 😧 😮 😲 😵 🤯 😳 😱 😨 😰 😢
//     \\        ts.setTextRange(clone, node);
//     \\        ts.setParent(clone, node.parent);
//     \\        return clone;😇 🙂 🙃 😉 😌 😍 😘 😗 😙 😚 😋 🤪 😜 😝 😛 🤑 🤗 🤓 😎 🤡 🤠 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 😤 😠 😡 🤬 😶 😐 😑 😯 😦 😧 😮 😲 😵 🤯 😳 😱 😨 😰 😢
//     \\    }, { since: "4.0", warnAfter: "4.1", message: "Use an appropriate `factory.update...` method instead, use `setCommentRange` or `setSourceMapRange`, and avoid setting `parent`." });
//     \\    // #endregion Node Factory top-level exports
//     \\    // DEPRECATION: Renamed node tests
//     \\    // DEPRECATION PLAN:🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ ⬛️ ⬜️ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣
//     \\    //     - soft: 4.0
//     \\    //     - warn: 4.1
//     \\    //     - error: TBD
//     \\    // #region Renamed node Tests
//     \\    /** @deprecated Use `isTypeAssertionExpression` instead. */
//     \\    ts.isTypeAssertion = ts.Debug.deprecate(function isTypeAssertion(node) {
//     \\        return node.kind === 209 /* TypeAssertionExpression */;
//     \\    }, {
//     \\        since: "4.0",
//     \\        warnAfter: "4.1",
//     \\        message: "Use `isTypeAssertionExpression` instead."
//     \\    });
//     \\    // #endregion
//     \\    // DEPRECATION: Renamed node tests
//     \\    // DEPRECATION PLAN:
//     \\    //     - soft: 4.2
//     \\    //     - warn: 4.3
//     \\    //     - error: TBD
//     \\    // #region Renamed node Tests
//     \\    /**
//     \\     * @deprecated Use `isMemberName` instead.
//     \\     */
//     \\    ts.isIdentifierOrPrivateIdentifier = ts.Debug.deprecate(function isIdentifierOrPrivateIdentifier(node) {
//     \\        return ts.isMemberName(node);
//     \\    }, {
//     \\        since: "4.2",
//     \\        warnAfter: "4.3",
//     \\        message: "Use `isMemberName` instead."
//     \\    });
//     \\    // #endregion Renamed node Tests
//     \\})(ts || (ts = {}));
// ;
// const ascii_text: []const u8 =
//     \\
//     \\package js_lexer
//     \\
//     \\// The lexer converts a source file to a stream of tokens. Unlike many
//     \\// compilers, esbuild does not run the lexer to completion before the parser is
//     \\// started. Instead, the lexer is called repeatedly by the parser as the parser
//     \\// parses the file. This is because many tokens are context-sensitive and need
//     \\// high-level information from the parser. Examples are regular expression
//     \\// literals and JSX elements.
//     \\//
//     \\// For efficiency, the text associated with textual tokens is stored in two
//     \\// separate ways depending on the token. Identifiers use UTF-8 encoding which
//     \\// allows them to be slices of the input file without allocating extra memory.
//     \\// Strings use UTF-16 encoding so they can represent unicode surrogates
//     \\// accurately.
//     \\
//     \\import (
//     \\"fmt"
//     \\"strconv"
//     \\"strings"
//     \\"unicode"
//     \\"unicode/utf8"
//     \\
//     \\"github.com/evanw/esbuild/internal/js_ast"
//     \\"github.com/evanw/esbuild/internal/logger"
//     \\)
//     \\
//     \\type T uint
//     \\
//     \\// If you add a new token, remember to add it to "tokenToString" too
//     \\const (
//     \\TEndOfFile T = iota
//     \\TSyntaxError
//     \\
//     \\// "#!/usr/bin/env node"
//     \\THashbang
//     \\
//     \\// Literals
//     \\TNoSubstitutionTemplateLiteral // Contents are in lexer.StringLiteral ([]uint16)
//     \\TNumericLiteral                // Contents are in lexer.Number (float64)
//     \\TStringLiteral                 // Contents are in lexer.StringLiteral ([]uint16)
//     \\TBigIntegerLiteral             // Contents are in lexer.Identifier (string)
//     \\
//     \\// Pseudo-literals
//     \\TTemplateHead   // Contents are in lexer.StringLiteral ([]uint16)
//     \\TTemplateMiddle // Contents are in lexer.StringLiteral ([]uint16)
//     \\TTemplateTail   // Contents are in lexer.StringLiteral ([]uint16)
//     \\
//     \\// Punctuation
//     \\TAmpersand
//     \\TAmpersandAmpersand
//     \\TAsterisk
//     \\TAsteriskAsterisk
//     \\TAt
//     \\TBar
//     \\TBarBar
//     \\TCaret
//     \\TCloseBrace
//     \\TCloseBracket
//     \\TCloseParen
//     \\TColon
//     \\TComma
//     \\TDot
//     \\TDotDotDot
//     \\TEqualsEquals
//     \\TEqualsEqualsEquals
//     \\TEqualsGreaterThan
//     \\TExclamation
//     \\TExclamationEquals
//     \\TExclamationEqualsEquals
//     \\TGreaterThan
//     \\TGreaterThanEquals
//     \\TGreaterThanGreaterThan
//     \\TGreaterThanGreaterThanGreaterThan
//     \\TLessThan
//     \\TLessThanEquals
//     \\TLessThanLessThan
//     \\TMinus
//     \\TMinusMinus
//     \\TOpenBrace
//     \\TOpenBracket
//     \\TOpenParen
//     \\TPercent
//     \\TPlus
//     \\TPlusPlus
//     \\TQuestion
//     \\TQuestionDot
//     \\TQuestionQuestion
//     \\TSemicolon
//     \\TSlash
//     \\TTilde
//     \\
//     \\// Assignments (keep in sync with IsAssign() below)
//     \\TAmpersandAmpersandEquals
//     \\TAmpersandEquals
//     \\TAsteriskAsteriskEquals
//     \\TAsteriskEquals
//     \\TBarBarEquals
//     \\TBarEquals
//     \\TCaretEquals
//     \\TEquals
//     \\TGreaterThanGreaterThanEquals
//     \\TGreaterThanGreaterThanGreaterThanEquals
//     \\TLessThanLessThanEquals
//     \\TMinusEquals
//     \\TPercentEquals
//     \\TPlusEquals
//     \\TQuestionQuestionEquals
//     \\TSlashEquals
//     \\
//     \\// Class-private fields and methods
//     \\TPrivateIdentifier
//     \\
//     \\// Identifiers
//     \\TIdentifier     // Contents are in lexer.Identifier (string)
//     \\TEscapedKeyword // A keyword that has been escaped as an identifer
//     \\
//     \\// Reserved words
//     \\TBreak
//     \\TCase
//     \\TCatch
//     \\TClass
//     \\TConst
//     \\TContinue
//     \\TDebugger
//     \\TDefault
//     \\TDelete
//     \\TDo
//     \\TElse
//     \\TEnum
//     \\TExport
//     \\TExtends
//     \\TFalse
//     \\TFinally
//     \\TFor
//     \\TFunction
//     \\TIf
//     \\TImport
//     \\TIn
//     \\TInstanceof
//     \\TNew
//     \\TNull
//     \\TReturn
//     \\TSuper
//     \\TSwitch
//     \\TThis
//     \\TThrow
//     \\TTrue
//     \\TTry
//     \\TTypeof
//     \\TVar
//     \\TVoid
//     \\TWhile
//     \\TWith
//     \\)
//     \\
//     \\func (t T) IsAssign() bool {
//     \\return t >= TAmpersandAmpersandEquals && t <= TSlashEquals
//     \\}
//     \\
//     \\var Keywords = map[string]T{
//     \\// Reserved words
//     \\"break":      TBreak,
//     \\"case":       TCase,
//     \\"catch":      TCatch,
//     \\"class":      TClass,
//     \\"const":      TConst,
//     \\"continue":   TContinue,
//     \\"debugger":   TDebugger,
//     \\"default":    TDefault,
//     \\"delete":     TDelete,
//     \\"do":         TDo,
//     \\"else":       TElse,
//     \\"enum":       TEnum,
//     \\"export":     TExport,
//     \\"extends":    TExtends,
//     \\"false":      TFalse,
//     \\"finally":    TFinally,
//     \\"for":        TFor,
//     \\"function":   TFunction,
//     \\"if":         TIf,
//     \\"import":     TImport,
//     \\"in":         TIn,
//     \\"instanceof": TInstanceof,
//     \\"new":        TNew,
//     \\"null":       TNull,
//     \\"return":     TReturn,
//     \\"super":      TSuper,
//     \\"switch":     TSwitch,
//     \\"this":       TThis,
//     \\"throw":      TThrow,
//     \\"true":       TTrue,
//     \\"try":        TTry,
//     \\"typeof":     TTypeof,
//     \\"var":        TVar,
//     \\"void":       TVoid,
//     \\"while":      TWhile,
//     \\"with":       TWith,
//     \\}
//     \\
//     \\var StrictModeReservedWords = map[string]bool{
//     \\"implements": true,
//     \\"interface":  true,
//     \\"let":        true,
//     \\"package":    true,
//     \\"private":    true,
//     \\"protected":  true,
//     \\"public":     true,
//     \\"static":     true,
//     \\"yield":      true,
//     \\}
//     \\
//     \\type json struct {
//     \\parse         bool
//     \\allowComments bool
//     \\}
//     \\
//     \\type Lexer struct {
//     \\log                             logger.Log
//     \\source                          logger.Source
//     \\tracker                         logger.LineColumnTracker
//     \\current                         int
//     \\start                           int
//     \\end                             int
//     \\ApproximateNewlineCount         int
//     \\LegacyOctalLoc                  logger.Loc
//     \\AwaitKeywordLoc                 logger.Loc
//     \\FnOrArrowStartLoc               logger.Loc
//     \\PreviousBackslashQuoteInJSX     logger.Range
//     \\LegacyHTMLCommentRange          logger.Range
//     \\Token                           T
//     \\HasNewlineBefore                bool
//     \\HasPureCommentBefore            bool
//     \\PreserveAllCommentsBefore       bool
//     \\IsLegacyOctalLiteral            bool
//     \\PrevTokenWasAwaitKeyword        bool
//     \\CommentsToPreserveBefore        []js_ast.Comment
//     \\AllOriginalComments             []js_ast.Comment
//     \\codePoint                       rune
//     \\Identifier                      string
//     \\JSXFactoryPragmaComment         logger.Span
//     \\JSXFragmentPragmaComment        logger.Span
//     \\SourceMappingURL                logger.Span
//     \\Number                          float64
//     \\rescanCloseBraceAsTemplateToken bool
//     \\forGlobalName                   bool
//     \\json                            json
//     \\prevErrorLoc                    logger.Loc
//     \\
//     \\// Escape sequences in string literals are decoded lazily because they are
//     \\// not interpreted inside tagged templates, and tagged templates can contain
//     \\// invalid escape sequences. If the decoded array is nil, the encoded value
//     \\// should be passed to "tryToDecodeEscapeSequences" first.
//     \\decodedStringLiteralOrNil []uint16
//     \\encodedStringLiteralStart int
//     \\encodedStringLiteralText  string
//     \\
//     \\// The log is disabled during speculative scans that may backtrack
//     \\IsLogDisabled bool
//     \\}
//     \\
//     \\type LexerPanic struct{}
//     \\
//     \\func NewLexer(log logger.Log, source logger.Source) Lexer {
//     \\lexer := Lexer{
//     \\log:               log,
//     \\source:            source,
//     \\tracker:           logger.MakeLineColumnTracker(&source),
//     \\prevErrorLoc:      logger.Loc{Start: -1},
//     \\FnOrArrowStartLoc: logger.Loc{Start: -1},
//     \\}
//     \\lexer.step()
//     \\lexer.Next()
//     \\return lexer
//     \\}
//     \\
//     \\func NewLexerGlobalName(log logger.Log, source logger.Source) Lexer {
//     \\lexer := Lexer{
//     \\log:               log,
//     \\source:            source,
//     \\tracker:           logger.MakeLineColumnTracker(&source),
//     \\prevErrorLoc:      logger.Loc{Start: -1},
//     \\FnOrArrowStartLoc: logger.Loc{Start: -1},
//     \\forGlobalName:     true,
//     \\}
//     \\lexer.step()
//     \\lexer.Next()
//     \\return lexer
//     \\}
//     \\
//     \\func NewLexerJSON(log logger.Log, source logger.Source, allowComments bool) Lexer {
//     \\lexer := Lexer{
//     \\log:               log,
//     \\source:            source,
//     \\tracker:           logger.MakeLineColumnTracker(&source),
//     \\prevErrorLoc:      logger.Loc{Start: -1},
//     \\FnOrArrowStartLoc: logger.Loc{Start: -1},
//     \\json: json{
//     \\parse:         true,
//     \\allowComments: allowComments,
//     \\},
//     \\}
//     \\lexer.step()
//     \\lexer.Next()
//     \\return lexer
//     \\}
//     \\
//     \\func (lexer *Lexer) Loc() logger.Loc {
//     \\return logger.Loc{Start: int32(lexer.start)}
//     \\}
//     \\
//     \\func (lexer *Lexer) Range() logger.Range {
//     \\return logger.Range{Loc: logger.Loc{Start: int32(lexer.start)}, Len: int32(lexer.end - lexer.start)}
//     \\}
//     \\
//     \\func (lexer *Lexer) Raw() string {
//     \\return lexer.source.Contents[lexer.start:lexer.end]
//     \\}
//     \\
//     \\func (lexer *Lexer) StringLiteral() []uint16 {
//     \\if lexer.decodedStringLiteralOrNil == nil {
//     \\// Lazily decode escape sequences if needed
//     \\if decoded, ok, end := lexer.tryToDecodeEscapeSequences(lexer.encodedStringLiteralStart, lexer.encodedStringLiteralText, true /* reportErrors */); !ok {
//     \\lexer.end = end
//     \\lexer.SyntaxError()
//     \\} else {
//     \\lexer.decodedStringLiteralOrNil = decoded
//     \\}
//     \\}
//     \\return lexer.decodedStringLiteralOrNil
//     \\}
//     \\
//     \\func (lexer *Lexer) CookedAndRawTemplateContents() ([]uint16, string) {
//     \\var raw string
//     \\
//     \\switch lexer.Token {
//     \\case TNoSubstitutionTemplateLiteral, TTemplateTail:
//     \\// "`x`" or "}x`"
//     \\raw = lexer.source.Contents[lexer.start+1 : lexer.end-1]
//     \\
//     \\case TTemplateHead, TTemplateMiddle:
//     \\// "`x${" or "}x${"
//     \\raw = lexer.source.Contents[lexer.start+1 : lexer.end-2]
//     \\}
//     \\
//     \\if strings.IndexByte(raw, '\r') != -1 {
//     \\// From the specification:
//     \\//
//     \\// 11.8.6.1 Static Semantics: TV and TRV
//     \\//
//     \\// TV excludes the code units of LineContinuation while TRV includes
//     \\// them. <CR><LF> and <CR> LineTerminatorSequences are normalized to
//     \\// <LF> for both TV and TRV. An explicit EscapeSequence is needed to
//     \\// include a <CR> or <CR><LF> sequence.
//     \\
//     \\bytes := []byte(raw)
//     \\end := 0
//     \\i := 0
//     \\
//     \\for i < len(bytes) {
//     \\c := bytes[i]
//     \\i++
//     \\
//     \\if c == '\r' {
//     \\// Convert '\r\n' into '\n'
//     \\if i < len(bytes) && bytes[i] == '\n' {
//     \\i++
//     \\}
//     \\
//     \\// Convert '\r' into '\n'
//     \\c = '\n'
//     \\}
//     \\
//     \\bytes[end] = c
//     \\end++
//     \\}
//     \\
//     \\raw = string(bytes[:end])
//     \\}
//     \\
//     \\// This will return nil on failure, which will become "undefined" for the tag
//     \\cooked, _, _ := lexer.tryToDecodeEscapeSequences(lexer.start+1, raw, false /* reportErrors */)
//     \\return cooked, raw
//     \\}
//     \\
//     \\func (lexer *Lexer) IsIdentifierOrKeyword() bool {
//     \\return lexer.Token >= TIdentifier
//     \\}
//     \\
//     \\func (lexer *Lexer) IsContextualKeyword(text string) bool {
//     \\return lexer.Token == TIdentifier && lexer.Raw() == text
//     \\}
//     \\
//     \\func (lexer *Lexer) ExpectContextualKeyword(text string) {
//     \\if !lexer.IsContextualKeyword(text) {
//     \\lexer.ExpectedString(fmt.Sprintf("%q", text))
//     \\}
//     \\lexer.Next()
//     \\}
//     \\
//     \\func (lexer *Lexer) SyntaxError() {
//     \\loc := logger.Loc{Start: int32(lexer.end)}
//     \\message := "Unexpected end of file"
//     \\if lexer.end < len(lexer.source.Contents) {
//     \\c, _ := utf8.DecodeRuneInString(lexer.source.Contents[lexer.end:])
//     \\if c < 0x20 {
//     \\message = fmt.Sprintf("Syntax error \"\\x%02X\"", c)
//     \\} else if c >= 0x80 {
//     \\message = fmt.Sprintf("Syntax error \"\\u{%x}\"", c)
//     \\} else if c != '"' {
//     \\message = fmt.Sprintf("Syntax error \"%c\"", c)
//     \\} else {
//     \\message = "Syntax error '\"'"
//     \\}
//     \\}
//     \\lexer.addError(loc, message)
//     \\panic(LexerPanic{})
//     \\}
//     \\
//     \\func (lexer *Lexer) ExpectedString(text string) {
//     \\// Provide a friendly error message about "await" without "async"
//     \\if lexer.PrevTokenWasAwaitKeyword {
//     \\var notes []logger.MsgData
//     \\if lexer.FnOrArrowStartLoc.Start != -1 {
//     \\note := logger.RangeData(&lexer.tracker, logger.Range{Loc: lexer.FnOrArrowStartLoc},
//     \\"Consider adding the \"async\" keyword here")
//     \\note.Location.Suggestion = "async"
//     \\notes = []logger.MsgData{note}
//     \\}
//     \\lexer.addRangeErrorWithNotes(RangeOfIdentifier(lexer.source, lexer.AwaitKeywordLoc),
//     \\"\"await\" can only be used inside an \"async\" function",
//     \\notes)
//     \\panic(LexerPanic{})
//     \\}
//     \\
//     \\found := fmt.Sprintf("%q", lexer.Raw())
//     \\if lexer.start == len(lexer.source.Contents) {
//     \\found = "end of file"
//     \\}
//     \\lexer.addRangeError(lexer.Range(), fmt.Sprintf("Expected %s but found %s", text, found))
//     \\panic(LexerPanic{})
//     \\}
//     \\
//     \\func (lexer *Lexer) Expected(token T) {
//     \\if text, ok := tokenToString[token]; ok {
//     \\lexer.ExpectedString(text)
//     \\} else {
//     \\lexer.Unexpected()
//     \\}
//     \\}
//     \\
//     \\func (lexer *Lexer) Unexpected() {
//     \\found := fmt.Sprintf("%q", lexer.Raw())
//     \\if lexer.start == len(lexer.source.Contents) {
//     \\found = "end of file"
//     \\}
//     \\lexer.addRangeError(lexer.Range(), fmt.Sprintf("Unexpected %s", found))
//     \\panic(LexerPanic{})
//     \\}
//     \\
//     \\func (lexer *Lexer) Expect(token T) {
//     \\if lexer.Token != token {
//     \\lexer.Expected(token)
//     \\}
//     \\lexer.Next()
//     \\}
//     \\
//     \\func (lexer *Lexer) ExpectOrInsertSemicolon() {
//     \\if lexer.Token == TSemicolon || (!lexer.HasNewlineBefore &&
//     \\lexer.Token != TCloseBrace && lexer.Token != TEndOfFile) {
//     \\lexer.Expect(TSemicolon)
//     \\}
//     \\}
//     \\func (lexer *Lexer) ExpectLessThan(isInsideJSXElement bool) {
//     \\switch lexer.Token {
//     \\case TLessThan:
//     \\if isInsideJSXElement {
//     \\lexer.NextInsideJSXElement()
//     \\} else {
//     \\lexer.Next()
//     \\}
//     \\
//     \\case TLessThanEquals:
//     \\lexer.Token = TEquals
//     \\lexer.start++
//     \\lexer.maybeExpandEquals()
//     \\
//     \\case TLessThanLessThan:
//     \\lexer.Token = TLessThan
//     \\lexer.start++
//     \\
//     \\case TLessThanLessThanEquals:
//     \\lexer.Token = TLessThanEquals
//     \\lexer.start++
//     \\
//     \\default:
//     \\lexer.Expected(TLessThan)
//     \\}
//     \\}
//     \\
//     \\// This parses a single ">" token. If that is the first part of a longer token,
//     \\// this function splits off the first ">" and leaves the remainder of the
//     \\// current token as another, smaller token. For example, ">>=" becomes ">=".
//     \\func (lexer *Lexer) ExpectGreaterThan(isInsideJSXElement bool) {
//     \\switch lexer.Token {
//     \\case TGreaterThan:
//     \\if isInsideJSXElement {
//     \\lexer.NextInsideJSXElement()
//     \\} else {
//     \\lexer.Next()
//     \\}
//     \\
//     \\case TGreaterThanEquals:
//     \\lexer.Token = TEquals
//     \\lexer.start++
//     \\lexer.maybeExpandEquals()
//     \\
//     \\case TGreaterThanGreaterThan:
//     \\lexer.Token = TGreaterThan
//     \\lexer.start++
//     \\
//     \\case TGreaterThanGreaterThanEquals:
//     \\lexer.Token = TGreaterThanEquals
//     \\lexer.start++
//     \\
//     \\case TGreaterThanGreaterThanGreaterThan:
//     \\lexer.Token = TGreaterThanGreaterThan
//     \\lexer.start++
//     \\
//     \\case TGreaterThanGreaterThanGreaterThanEquals:
//     \\lexer.Token = TGreaterThanGreaterThanEquals
//     \\lexer.start++
//     \\
//     \\default:
//     \\lexer.Expected(TGreaterThan)
//     \\}
//     \\}
//     \\
//     \\func (lexer *Lexer) maybeExpandEquals() {
//     \\switch lexer.codePoint {
//     \\case '>':
//     \\// "=" + ">" = "=>"
//     \\lexer.Token = TEqualsGreaterThan
//     \\lexer.step()
//     \\
//     \\case '=':
//     \\// "=" + "=" = "=="
//     \\lexer.Token = TEqualsEquals
//     \\lexer.step()
//     \\
//     \\if lexer.Token == '=' {
//     \\// "=" + "==" = "==="
//     \\lexer.Token = TEqualsEqualsEquals
//     \\lexer.step()
//     \\}
//     \\}
//     \\}
//     \\
//     \\func IsIdentifier(text string) bool {
//     \\if len(text) == 0 {
//     \\return false
//     \\}
//     \\for i, codePoint := range text {
//     \\if i == 0 {
//     \\if !IsIdentifierStart(codePoint) {
//     \\return false
//     \\}
//     \\} else {
//     \\if !IsIdentifierContinue(codePoint) {
//     \\return false
//     \\}
//     \\}
//     \\}
//     \\return true
//     \\}
//     \\
//     \\func IsIdentifierES5AndESNext(text string) bool {
//     \\if len(text) == 0 {
//     \\return false
//     \\}
//     \\for i, codePoint := range text {
//     \\if i == 0 {
//     \\if !IsIdentifierStartES5AndESNext(codePoint) {
//     \\return false
//     \\}
//     \\} else {
//     \\if !IsIdentifierContinueES5AndESNext(codePoint) {
//     \\return false
//     \\}
//     \\}
//     \\}
//     \\return true
//     \\}
//     \\
//     \\func ForceValidIdentifier(text string) string {
//     \\if IsIdentifier(text) {
//     \\return text
//     \\}
//     \\sb := strings.Builder{}
//     \\
//     \\// Identifier start
//     \\c, width := utf8.DecodeRuneInString(text)
//     \\text = text[width:]
//     \\if IsIdentifierStart(c) {
//     \\sb.WriteRune(c)
//     \\} else {
//     \\sb.WriteRune('_')
//     \\}
//     \\
//     \\// Identifier continue
//     \\for text != "" {
//     \\c, width := utf8.DecodeRuneInString(text)
//     \\text = text[width:]
//     \\if IsIdentifierContinue(c) {
//     \\sb.WriteRune(c)
//     \\} else {
//     \\sb.WriteRune('_')
//     \\}
//     \\}
//     \\
//     \\return sb.String()
//     \\}
//     \\
//     \\// This does "IsIdentifier(UTF16ToString(text))" without any allocations
//     \\func IsIdentifierUTF16(text []uint16) bool {
//     \\n := len(text)
//     \\if n == 0 {
//     \\return false
//     \\}
//     \\for i := 0; i < n; i++ {
//     \\isStart := i == 0
//     \\r1 := rune(text[i])
//     \\if r1 >= 0xD800 && r1 <= 0xDBFF && i+1 < n {
//     \\if r2 := rune(text[i+1]); r2 >= 0xDC00 && r2 <= 0xDFFF {
//     \\r1 = (r1 << 10) + r2 + (0x10000 - (0xD800 << 10) - 0xDC00)
//     \\i++
//     \\}
//     \\}
//     \\if isStart {
//     \\if !IsIdentifierStart(r1) {
//     \\return false
//     \\}
//     \\} else {
//     \\if !IsIdentifierContinue(r1) {
//     \\return false
//     \\}
//     \\}
//     \\}
//     \\return true
//     \\}
//     \\
//     \\// This does "IsIdentifierES5AndESNext(UTF16ToString(text))" without any allocations
//     \\func IsIdentifierES5AndESNextUTF16(text []uint16) bool {
//     \\n := len(text)
//     \\if n == 0 {
//     \\return false
//     \\}
//     \\for i := 0; i < n; i++ {
//     \\isStart := i == 0
//     \\r1 := rune(text[i])
//     \\if r1 >= 0xD800 && r1 <= 0xDBFF && i+1 < n {
//     \\if r2 := rune(text[i+1]); r2 >= 0xDC00 && r2 <= 0xDFFF {
//     \\r1 = (r1 << 10) + r2 + (0x10000 - (0xD800 << 10) - 0xDC00)
//     \\i++
//     \\}
//     \\}
//     \\if isStart {
//     \\if !IsIdentifierStartES5AndESNext(r1) {
//     \\return false
//     \\}
//     \\} else {
//     \\if !IsIdentifierContinueES5AndESNext(r1) {
//     \\return false
//     \\}
//     \\}
//     \\}
//     \\return true
//     \\}
//     \\
//     \\func IsIdentifierStart(codePoint rune) bool {
//     \\switch codePoint {
//     \\case '_', '$',
//     \\'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
//     \\'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
//     \\'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
//     \\'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z':
//     \\return true
//     \\}
//     \\
//     \\// All ASCII identifier start code points are listed above
//     \\if codePoint < 0x7F {
//     \\return false
//     \\}
//     \\
//     \\return unicode.Is(idStartES5OrESNext, codePoint)
//     \\}
//     \\
//     \\func IsIdentifierContinue(codePoint rune) bool {
//     \\switch codePoint {
//     \\case '_', '$', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
//     \\'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
//     \\'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
//     \\'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
//     \\'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z':
//     \\return true
//     \\}
//     \\
//     \\// All ASCII identifier start code points are listed above
//     \\if codePoint < 0x7F {
//     \\return false
//     \\}
//     \\
//     \\// ZWNJ and ZWJ are allowed in identifiers
//     \\if codePoint == 0x200C || codePoint == 0x200D {
//     \\return true
//     \\}
//     \\
//     \\return unicode.Is(idContinueES5OrESNext, codePoint)
//     \\}
//     \\
//     \\func IsIdentifierStartES5AndESNext(codePoint rune) bool {
//     \\switch codePoint {
//     \\case '_', '$',
//     \\'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
//     \\'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
//     \\'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
//     \\'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z':
//     \\return true
//     \\}
//     \\
//     \\// All ASCII identifier start code points are listed above
//     \\if codePoint < 0x7F {
//     \\return false
//     \\}
//     \\
//     \\return unicode.Is(idStartES5AndESNext, codePoint)
//     \\}
//     \\
//     \\func IsIdentifierContinueES5AndESNext(codePoint rune) bool {
//     \\switch codePoint {
//     \\case '_', '$', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
//     \\'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
//     \\'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
//     \\'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
//     \\'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z':
//     \\return true
//     \\}
//     \\
//     \\// All ASCII identifier start code points are listed above
//     \\if codePoint < 0x7F {
//     \\return false
//     \\}
//     \\
//     \\// ZWNJ and ZWJ are allowed in identifiers
//     \\if codePoint == 0x200C || codePoint == 0x200D {
//     \\return true
//     \\}
//     \\
//     \\return unicode.Is(idContinueES5AndESNext, codePoint)
//     \\}
//     \\
//     \\// See the "White Space Code Points" table in the ECMAScript standard
//     \\func IsWhitespace(codePoint rune) bool {
//     \\switch codePoint {
//     \\case
//     \\'\u0009', // character tabulation
//     \\'\u000B', // line tabulation
//     \\'\u000C', // form feed
//     \\'\u0020', // space
//     \\'\u00A0', // no-break space
//     \\
//     \\// Unicode "Space_Separator" code points
//     \\'\u1680', // ogham space mark
//     \\'\u2000', // en quad
//     \\'\u2001', // em quad
//     \\'\u2002', // en space
//     \\'\u2003', // em space
//     \\'\u2004', // three-per-em space
//     \\'\u2005', // four-per-em space
//     \\'\u2006', // six-per-em space
//     \\'\u2007', // figure space
//     \\'\u2008', // punctuation space
//     \\'\u2009', // thin space
//     \\'\u200A', // hair space
//     \\'\u202F', // narrow no-break space
//     \\'\u205F', // medium mathematical space
//     \\'\u3000', // ideographic space
//     \\
//     \\'\uFEFF': // zero width non-breaking space
//     \\return true
//     \\
//     \\default:
//     \\return false
//     \\}
//     \\}
//     \\
//     \\func RangeOfIdentifier(source logger.Source, loc logger.Loc) logger.Range {
//     \\text := source.Contents[loc.Start:]
//     \\if len(text) == 0 {
//     \\return logger.Range{Loc: loc, Len: 0}
//     \\}
//     \\
//     \\i := 0
//     \\c, _ := utf8.DecodeRuneInString(text[i:])
//     \\
//     \\// Handle private names
//     \\if c == '#' {
//     \\i++
//     \\c, _ = utf8.DecodeRuneInString(text[i:])
//     \\}
//     \\
//     \\if IsIdentifierStart(c) || c == '\\' {
//     \\// Search for the end of the identifier
//     \\for i < len(text) {
//     \\c2, width2 := utf8.DecodeRuneInString(text[i:])
//     \\if c2 == '\\' {
//     \\i += width2
//     \\
//     \\// Skip over bracketed unicode escapes such as "\u{10000}"
//     \\if i+2 < len(text) && text[i] == 'u' && text[i+1] == '{' {
//     \\i += 2
//     \\for i < len(text) {
//     \\if text[i] == '}' {
//     \\i++
//     \\break
//     \\}
//     \\i++
//     \\}
//     \\}
//     \\} else if !IsIdentifierContinue(c2) {
//     \\return logger.Range{Loc: loc, Len: int32(i)}
//     \\} else {
//     \\i += width2
//     \\}
//     \\}
//     \\}
//     \\
//     \\// When minifying, this identifier may have originally been a string
//     \\return source.RangeOfString(loc)
//     \\}
//     \\
//     \\func (lexer *Lexer) ExpectJSXElementChild(token T) {
//     \\if lexer.Token != token {
//     \\lexer.Expected(token)
//     \\}
//     \\lexer.NextJSXElementChild()
//     \\}
//     \\
//     \\func (lexer *Lexer) NextJSXElementChild() {
//     \\lexer.HasNewlineBefore = false
//     \\originalStart := lexer.end
//     \\
//     \\for {
//     \\lexer.start = lexer.end
//     \\lexer.Token = 0
//     \\
//     \\switch lexer.codePoint {
//     \\case -1: // This indicates the end of the file
//     \\lexer.Token = TEndOfFile
//     \\
//     \\case '{':
//     \\lexer.step()
//     \\lexer.Token = TOpenBrace
//     \\
//     \\case '<':
//     \\lexer.step()
//     \\lexer.Token = TLessThan
//     \\
//     \\default:
//     \\needsFixing := false
//     \\
//     \\stringLiteral:
//     \\for {
//     \\switch lexer.codePoint {
//     \\case -1:
//     \\// Reaching the end of the file without a closing element is an error
//     \\lexer.SyntaxError()
//     \\
//     \\case '&', '\r', '\n', '\u2028', '\u2029':
//     \\// This needs fixing if it has an entity or if it's a multi-line string
//     \\needsFixing = true
//     \\lexer.step()
//     \\
//     \\case '{', '<':
//     \\// Stop when the string ends
//     \\break stringLiteral
//     \\
//     \\default:
//     \\// Non-ASCII strings need the slow path
//     \\if lexer.codePoint >= 0x80 {
//     \\needsFixing = true
//     \\}
//     \\lexer.step()
//     \\}
//     \\}
//     \\
//     \\lexer.Token = TStringLiteral
//     \\text := lexer.source.Contents[originalStart:lexer.end]
//     \\
//     \\if needsFixing {
//     \\// Slow path
//     \\lexer.decodedStringLiteralOrNil = fixWhitespaceAndDecodeJSXEntities(text)
//     \\
//     \\// Skip this token if it turned out to be empty after trimming
//     \\if len(lexer.decodedStringLiteralOrNil) == 0 {
//     \\lexer.HasNewlineBefore = true
//     \\continue
//     \\}
//     \\} else {
//     \\// Fast path
//     \\n := len(text)
//     \\copy := make([]uint16, n)
//     \\for i := 0; i < n; i++ {
//     \\copy[i] = uint16(text[i])
//     \\}
//     \\lexer.decodedStringLiteralOrNil = copy
//     \\}
//     \\}
//     \\
//     \\break
//     \\}
//     \\}
//     \\
//     \\func (lexer *Lexer) ExpectInsideJSXElement(token T) {
//     \\if lexer.Token != token {
//     \\lexer.Expected(token)
//     \\}
//     \\lexer.NextInsideJSXElement()
//     \\}
//     \\
//     \\func (lexer *Lexer) NextInsideJSXElement() {
//     \\lexer.HasNewlineBefore = false
//     \\
//     \\for {
//     \\lexer.start = lexer.end
//     \\lexer.Token = 0
//     \\
//     \\switch lexer.codePoint {
//     \\case -1: // This indicates the end of the file
//     \\lexer.Token = TEndOfFile
//     \\
//     \\case '\r', '\n', '\u2028', '\u2029':
//     \\lexer.step()
//     \\lexer.HasNewlineBefore = true
//     \\continue
//     \\
//     \\case '\t', ' ':
//     \\lexer.step()
//     \\continue
//     \\
//     \\case '.':
//     \\lexer.step()
//     \\lexer.Token = TDot
//     \\
//     \\case '=':
//     \\lexer.step()
//     \\lexer.Token = TEquals
//     \\
//     \\case '{':
//     \\lexer.step()
//     \\lexer.Token = TOpenBrace
//     \\
//     \\case '}':
//     \\lexer.step()
//     \\lexer.Token = TCloseBrace
//     \\
//     \\case '<':
//     \\lexer.step()
//     \\lexer.Token = TLessThan
//     \\
//     \\case '>':
//     \\lexer.step()
//     \\lexer.Token = TGreaterThan
//     \\
//     \\case '/':
//     \\// '/' or '//' or '/* ... */'
//     \\lexer.step()
//     \\switch lexer.codePoint {
//     \\case '/':
//     \\singleLineComment:
//     \\for {
//     \\lexer.step()
//     \\switch lexer.codePoint {
//     \\case '\r', '\n', '\u2028', '\u2029':
//     \\break singleLineComment
//     \\
//     \\case -1: // This indicates the end of the file
//     \\break singleLineComment
//     \\}
//     \\}
//     \\continue
//     \\
//     \\case '*':
//     \\lexer.step()
//     \\startRange := lexer.Range()
//     \\multiLineComment:
//     \\for {
//     \\switch lexer.codePoint {
//     \\case '*':
//     \\lexer.step()
//     \\if lexer.codePoint == '/' {
//     \\lexer.step()
//     \\break multiLineComment
//     \\}
//     \\
//     \\case '\r', '\n', '\u2028', '\u2029':
//     \\lexer.step()
//     \\lexer.HasNewlineBefore = true
//     \\
//     \\case -1: // This indicates the end of the file
//     \\lexer.start = lexer.end
//     \\lexer.addErrorWithNotes(lexer.Loc(), "Expected \"*/\" to terminate multi-line comment",
//     \\[]logger.MsgData{logger.RangeData(&lexer.tracker, startRange, "The multi-line comment starts here")})
//     \\panic(LexerPanic{})
//     \\
//     \\default:
//     \\lexer.step()
//     \\}
//     \\}
//     \\continue
//     \\
//     \\default:
//     \\lexer.Token = TSlash
//     \\}
//     \\
//     \\case '\'', '"':
//     \\var backslash logger.Range
//     \\quote := lexer.codePoint
//     \\needsDecode := false
//     \\lexer.step()
//     \\
//     \\stringLiteral:
//     \\for {
//     \\switch lexer.codePoint {
//     \\case -1: // This indicates the end of the file
//     \\lexer.SyntaxError()
//     \\
//     \\case '&':
//     \\needsDecode = true
//     \\lexer.step()
//     \\
//     \\case '\\':
//     \\backslash = logger.Range{Loc: logger.Loc{Start: int32(lexer.end)}, Len: 1}
//     \\lexer.step()
//     \\continue
//     \\
//     \\case quote:
//     \\if backslash.Len > 0 {
//     \\backslash.Len++
//     \\lexer.PreviousBackslashQuoteInJSX = backslash
//     \\}
//     \\lexer.step()
//     \\break stringLiteral
//     \\
//     \\default:
//     \\// Non-ASCII strings need the slow path
//     \\if lexer.codePoint >= 0x80 {
//     \\needsDecode = true
//     \\}
//     \\lexer.step()
//     \\}
//     \\backslash = logger.Range{}
//     \\}
//     \\
//     \\lexer.Token = TStringLiteral
//     \\text := lexer.source.Contents[lexer.start+1 : lexer.end-1]
//     \\
//     \\if needsDecode {
//     \\// Slow path
//     \\lexer.decodedStringLiteralOrNil = decodeJSXEntities([]uint16{}, text)
//     \\} else {
//     \\// Fast path
//     \\n := len(text)
//     \\copy := make([]uint16, n)
//     \\for i := 0; i < n; i++ {
//     \\copy[i] = uint16(text[i])
//     \\}
//     \\lexer.decodedStringLiteralOrNil = copy
//     \\}
//     \\
//     \\default:
//     \\// Check for unusual whitespace characters
//     \\if IsWhitespace(lexer.codePoint) {
//     \\lexer.step()
//     \\continue
//     \\}
//     \\
//     \\if IsIdentifierStart(lexer.codePoint) {
//     \\lexer.step()
//     \\for IsIdentifierContinue(lexer.codePoint) || lexer.codePoint == '-' {
//     \\lexer.step()
//     \\}
//     \\
//     \\// Parse JSX namespaces. These are not supported by React or TypeScript
//     \\// but someone using JSX syntax in more obscure ways may find a use for
//     \\// them. A namespaced name is just always turned into a string so you
//     \\// can't use this feature to reference JavaScript identifiers.
//     \\if lexer.codePoint == ':' {
//     \\lexer.step()
//     \\if IsIdentifierStart(lexer.codePoint) {
//     \\lexer.step()
//     \\for IsIdentifierContinue(lexer.codePoint) || lexer.codePoint == '-' {
//     \\lexer.step()
//     \\}
//     \\} else {
//     \\lexer.addError(logger.Loc{Start: lexer.Range().End()},
//     \\fmt.Sprintf("Expected identifier after %q in namespaced JSX name", lexer.Raw()))
//     \\}
//     \\}
//     \\
//     \\lexer.Identifier = lexer.Raw()
//     \\lexer.Token = TIdentifier
//     \\break
//     \\}
//     \\
//     \\lexer.end = lexer.current
//     \\lexer.Token = TSyntaxError
//     \\}
//     \\
//     \\return
//     \\}
//     \\}
//     \\
//     \\func (lexer *Lexer) Next() {
//     \\lexer.HasNewlineBefore = lexer.end == 0
//     \\lexer.HasPureCommentBefore = false
//     \\lexer.PrevTokenWasAwaitKeyword = false
//     \\lexer.CommentsToPreserveBefore = nil
//     \\
//     \\for {
//     \\lexer.start = lexer.end
//     \\lexer.Token = 0
//     \\
//     \\switch lexer.codePoint {
//     \\case -1: // This indicates the end of the file
//     \\lexer.Token = TEndOfFile
//     \\
//     \\case '#':
//     \\if lexer.start == 0 && strings.HasPrefix(lexer.source.Contents, "#!") {
//     \\// "#!/usr/bin/env node"
//     \\lexer.Token = THashbang
//     \\hashbang:
//     \\for {
//     \\lexer.step()
//     \\switch lexer.codePoint {
//     \\case '\r', '\n', '\u2028', '\u2029':
//     \\break hashbang
//     \\
//     \\case -1: // This indicates the end of the file
//     \\break hashbang
//     \\}
//     \\}
//     \\lexer.Identifier = lexer.Raw()
//     \\} else {
//     \\// "#foo"
//     \\lexer.step()
//     \\}
// ;

// const repeat_count: usize = 1;
// const loop_count: usize = 1000;

// pub fn main() anyerror!void {
//     try HashTable.init(std.heap.c_allocator);
//     Bitset.init();
//     {

//         // Ensure that the optimizer doesn't do something fancy with static memory addresses
//         var code = try std.heap.c_allocator.dupe(u8, unicode_text);

//         var iter = std.unicode.Utf8Iterator{ .bytes = code, .i = 0 };
//         var hash_table_count: usize = 0;
//         var jump_table_count: usize = 0;
//         var jump_table_elapsed: u64 = 0;
//         var hash_table_elapsed: u64 = 0;
//         var binary_search_elapsed: u64 = 0;
//         var binary_search_count: usize = 0;
//         var bitset_elapsed: u64 = 0;
//         var bitset_count: usize = 0;

//         // change up the order these run in
//         var loop_i: usize = 0;
//         while (loop_i < loop_count) : (loop_i += 1) {
//             {
//                 var iteration_i: usize = 0;
//                 var timer = try std.time.Timer.start();
//                 while (iteration_i < repeat_count) : (iteration_i += 1) {
//                     @setEvalBranchQuota(99999);
//                     iter = std.unicode.Utf8Iterator{ .bytes = code, .i = 0 };
//                     hash_table_count = 0;
//                     while (iter.nextCodepoint()) |cp| {
//                         hash_table_count += @as(usize, @intFromBool(HashTable.isIdentifierStart(cp) or HashTable.isIdentifierPart(cp)));
//                     }
//                 }
//                 hash_table_elapsed += timer.read();
//             }

//             {
//                 var iteration_i: usize = 0;
//                 var timer = try std.time.Timer.start();
//                 while (iteration_i < repeat_count) : (iteration_i += 1) {
//                     @setEvalBranchQuota(99999);
//                     iter = std.unicode.Utf8Iterator{ .bytes = code, .i = 0 };
//                     jump_table_count = 0;
//                     while (iter.nextCodepoint()) |cp| {
//                         jump_table_count += @as(
//                             usize,
//                             @intFromBool(JumpTable.isIdentifierStart(cp) or JumpTable.isIdentifierPart(cp)),
//                         );
//                     }
//                 }
//                 jump_table_elapsed += timer.read();
//             }

//             {
//                 var iteration_i: usize = 0;
//                 var timer = try std.time.Timer.start();
//                 while (iteration_i < repeat_count) : (iteration_i += 1) {
//                     @setEvalBranchQuota(99999);
//                     iter = std.unicode.Utf8Iterator{ .bytes = code, .i = 0 };
//                     binary_search_count = 0;
//                     while (iter.nextCodepoint()) |cp| {
//                         binary_search_count += @as(
//                             usize,
//                             @intFromBool(
//                                 BinarySearch.isIdentifierStart(
//                                     cp,
//                                 ) or BinarySearch.isIdentifierPart(
//                                     cp,
//                                 ),
//                             ),
//                         );
//                     }
//                 }
//                 binary_search_elapsed += timer.read();
//             }

//             {
//                 var iteration_i: usize = 0;
//                 var timer = try std.time.Timer.start();
//                 while (iteration_i < repeat_count) : (iteration_i += 1) {
//                     @setEvalBranchQuota(99999);
//                     iter = std.unicode.Utf8Iterator{ .bytes = code, .i = 0 };
//                     bitset_count = 0;
//                     while (iter.nextCodepoint()) |cp| {
//                         bitset_count += @as(
//                             usize,
//                             @intFromBool(
//                                 Bitset.isIdentifierStart(
//                                     cp,
//                                 ) or Bitset.isIdentifierPart(
//                                     cp,
//                                 ),
//                             ),
//                         );
//                     }
//                 }
//                 bitset_elapsed += timer.read();
//             }
//         }

//         .print(
//             \\---- Unicode text -----
//             \\
//             \\Timings (sum of running {d} times each, lower is better):
//             \\
//             \\  Binary Search               : {d}ns
//             \\  Hash Table                  : {d}ns
//             \\  Switch statement            : {d}ns
//             \\  Bitset                      : {d}ns
//             \\
//             \\Match count (these should be the same):
//             \\
//             \\  Binary Search               : {d}
//             \\  Hash Table                  : {d}
//             \\  Switch statement            : {d}
//             \\  Bitset                      : {d}
//             \\
//             \\
//         ,
//             .{
//                 repeat_count * loop_count,
//                 binary_search_elapsed,
//                 hash_table_elapsed,
//                 jump_table_elapsed,
//                 bitset_elapsed,

//                 binary_search_count,
//                 hash_table_count,
//                 jump_table_count,
//                 bitset_count,
//             },
//         );
//     }

//     {

//         // Ensure that the optimizer doesn't do something fancy with static memory addresses
//         var code = try std.heap.c_allocator.dupe(u8, ascii_text);

//         var iter = std.unicode.Utf8Iterator{ .bytes = code, .i = 0 };
//         var hash_table_count: usize = 0;
//         var jump_table_count: usize = 0;
//         var jump_table_elapsed: u64 = 0;
//         var hash_table_elapsed: u64 = 0;
//         var binary_search_elapsed: u64 = 0;
//         var binary_search_count: usize = 0;
//         var bitset_count: usize = 0;
//         var bitset_elapsed: u64 = 0;

//         // change up the order these run in
//         var loop_i: usize = 0;
//         while (loop_i < loop_count) : (loop_i += 1) {
//             {
//                 var iteration_i: usize = 0;
//                 var timer = try std.time.Timer.start();
//                 while (iteration_i < repeat_count) : (iteration_i += 1) {
//                     @setEvalBranchQuota(99999);
//                     iter = std.unicode.Utf8Iterator{ .bytes = code, .i = 0 };
//                     hash_table_count = 0;
//                     while (iter.nextCodepoint()) |cp| {
//                         hash_table_count += @as(usize, @intFromBool(HashTable.isIdentifierStart(cp) or HashTable.isIdentifierPart(cp)));
//                     }
//                 }
//                 hash_table_elapsed += timer.read();
//             }

//             {
//                 var iteration_i: usize = 0;
//                 var timer = try std.time.Timer.start();
//                 while (iteration_i < repeat_count) : (iteration_i += 1) {
//                     @setEvalBranchQuota(99999);
//                     iter = std.unicode.Utf8Iterator{ .bytes = code, .i = 0 };
//                     jump_table_count = 0;
//                     while (iter.nextCodepoint()) |cp| {
//                         jump_table_count += @as(
//                             usize,
//                             @intFromBool(JumpTable.isIdentifierStart(cp) or JumpTable.isIdentifierPart(cp)),
//                         );
//                     }
//                 }
//                 jump_table_elapsed += timer.read();
//             }

//             {
//                 var iteration_i: usize = 0;
//                 var timer = try std.time.Timer.start();
//                 while (iteration_i < repeat_count) : (iteration_i += 1) {
//                     @setEvalBranchQuota(99999);
//                     iter = std.unicode.Utf8Iterator{ .bytes = code, .i = 0 };
//                     binary_search_count = 0;
//                     while (iter.nextCodepoint()) |cp| {
//                         binary_search_count += @as(
//                             usize,
//                             @intFromBool(
//                                 BinarySearch.isIdentifierStart(
//                                     cp,
//                                 ) or BinarySearch.isIdentifierPart(
//                                     cp,
//                                 ),
//                             ),
//                         );
//                     }
//                 }
//                 binary_search_elapsed += timer.read();
//             }

//             {
//                 var iteration_i: usize = 0;
//                 var timer = try std.time.Timer.start();
//                 while (iteration_i < repeat_count) : (iteration_i += 1) {
//                     @setEvalBranchQuota(99999);
//                     iter = std.unicode.Utf8Iterator{ .bytes = code, .i = 0 };
//                     bitset_count = 0;
//                     while (iter.nextCodepoint()) |cp| {
//                         bitset_count += @as(
//                             usize,
//                             @intFromBool(
//                                 Bitset.isIdentifierStart(
//                                     cp,
//                                 ) or Bitset.isIdentifierPart(
//                                     cp,
//                                 ),
//                             ),
//                         );
//                     }
//                 }
//                 bitset_elapsed += timer.read();
//             }
//         }

//         {
//             iter = std.unicode.Utf8Iterator{ .bytes = ascii_text, .i = 0 };
//             while (iter.nextCodepoint()) |cp| {
//                 if (cp > 127) std.debug.panic("This is not ASCII at {d}", .{iter.i});
//             }
//         }

//         (
//             \\---- ASCII text -----
//             \\
//             \\Timings (sum of running {d} times each, lower is better):
//             \\
//             \\  Binary Search               : {d}ns
//             \\  Hash Table                  : {d}ns
//             \\  Switch statement            : {d}ns
//             \\  Bitset                      : {d}ns
//             \\
//             \\Match count (these should be the same):
//             \\
//             \\  Binary Search               : {d}
//             \\  Hash Table                  : {d}
//             \\  Switch statement            : {d}
//             \\  Bitset                      : {d}
//             \\
//             \\
//         ,
//             .{
//                 repeat_count * loop_count,
//                 binary_search_elapsed,
//                 hash_table_elapsed,
//                 jump_table_elapsed,
//                 bitset_elapsed,

//                 binary_search_count,
//                 hash_table_count,
//                 jump_table_count,
//                 bitset_count,
//             },
//         );
//     }
// }
