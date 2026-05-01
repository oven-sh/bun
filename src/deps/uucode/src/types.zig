pub const GeneralCategory = enum(u5) {
    letter_uppercase, // Lu
    letter_lowercase, // Ll
    letter_titlecase, // Lt
    letter_modifier, // Lm
    letter_other, // Lo
    mark_nonspacing, // Mn
    mark_spacing_combining, // Mc
    mark_enclosing, // Me
    number_decimal_digit, // Nd
    number_letter, // Nl
    number_other, // No
    punctuation_connector, // Pc
    punctuation_dash, // Pd
    punctuation_open, // Ps
    punctuation_close, // Pe
    punctuation_initial_quote, // Pi
    punctuation_final_quote, // Pf
    punctuation_other, // Po
    symbol_math, // Sm
    symbol_currency, // Sc
    symbol_modifier, // Sk
    symbol_other, // So
    separator_space, // Zs
    separator_line, // Zl
    separator_paragraph, // Zp
    other_control, // Cc
    other_format, // Cf
    other_surrogate, // Cs
    other_private_use, // Co
    other_not_assigned, // Cn
};

// TODO: actually parse `DerivedBidiClass.txt`
pub const BidiClass = enum(u5) {
    left_to_right, // L
    left_to_right_embedding, // LRE
    left_to_right_override, // LRO
    right_to_left, // R
    right_to_left_arabic, // AL
    right_to_left_embedding, // RLE
    right_to_left_override, // RLO
    pop_directional_format, // PDF
    european_number, // EN
    european_number_separator, // ES
    european_number_terminator, // ET
    arabic_number, // AN
    common_number_separator, // CS
    nonspacing_mark, // NSM
    boundary_neutral, // BN
    paragraph_separator, // B
    segment_separator, // S
    whitespace, // WS
    other_neutrals, // ON
    left_to_right_isolate, // LRI
    right_to_left_isolate, // RLI
    first_strong_isolate, // FSI
    pop_directional_isolate, // PDI
};

pub const DecompositionType = enum(u5) {
    default,
    canonical,
    font,
    noBreak,
    initial,
    medial,
    final,
    isolated,
    circle,
    super,
    sub,
    vertical,
    wide,
    narrow,
    small,
    square,
    fraction,
    compat,
};

pub const NumericType = enum(u2) {
    none,
    decimal,
    digit,
    numeric,
};

pub const IndicConjunctBreak = enum(u2) {
    none,
    linker,
    consonant,
    extend,
};

pub const EastAsianWidth = enum(u3) {
    neutral,
    fullwidth,
    halfwidth,
    wide,
    narrow,
    ambiguous,
};

pub const OriginalGraphemeBreak = enum(u4) {
    other,
    prepend,
    cr,
    lf,
    control,
    extend,
    regional_indicator,
    spacing_mark,
    l,
    v,
    t,
    lv,
    lvt,
    zwj,
};

pub const GraphemeBreak = enum(u5) {
    other,
    control,
    prepend,
    cr,
    lf,
    regional_indicator,
    spacing_mark,
    l,
    v,
    t,
    lv,
    lvt,
    zwj,
    zwnj,
    extended_pictographic,
    emoji_modifier_base,
    emoji_modifier,
    // extend, ==
    //   zwnj +
    //   indic_conjunct_break_extend +
    //   indic_conjunct_break_linker
    indic_conjunct_break_extend,
    indic_conjunct_break_linker,
    indic_conjunct_break_consonant,
};

pub const SpecialCasingCondition = enum(u4) {
    none,
    final_sigma,
    after_soft_dotted,
    more_above,
    after_i,
    not_before_dot,
    lt,
    tr,
    az,
};

pub const Block = enum(u9) {
    no_block,
    adlam,
    aegean_numbers,
    ahom,
    alchemical_symbols,
    alphabetic_presentation_forms,
    anatolian_hieroglyphs,
    ancient_greek_musical_notation,
    ancient_greek_numbers,
    ancient_symbols,
    arabic,
    arabic_extended_a,
    arabic_extended_b,
    arabic_extended_c,
    arabic_mathematical_alphabetic_symbols,
    arabic_presentation_forms_a,
    arabic_presentation_forms_b,
    arabic_supplement,
    armenian,
    arrows,
    avestan,
    balinese,
    bamum,
    bamum_supplement,
    basic_latin,
    bassa_vah,
    batak,
    bengali,
    bhaiksuki,
    block_elements,
    bopomofo,
    bopomofo_extended,
    box_drawing,
    brahmi,
    braille_patterns,
    buginese,
    buhid,
    byzantine_musical_symbols,
    carian,
    caucasian_albanian,
    chakma,
    cham,
    cherokee,
    cherokee_supplement,
    chess_symbols,
    chorasmian,
    cjk_compatibility,
    cjk_compatibility_forms,
    cjk_compatibility_ideographs,
    cjk_compatibility_ideographs_supplement,
    cjk_radicals_supplement,
    cjk_strokes,
    cjk_symbols_and_punctuation,
    cjk_unified_ideographs,
    cjk_unified_ideographs_extension_a,
    cjk_unified_ideographs_extension_b,
    cjk_unified_ideographs_extension_c,
    cjk_unified_ideographs_extension_d,
    cjk_unified_ideographs_extension_e,
    cjk_unified_ideographs_extension_f,
    cjk_unified_ideographs_extension_g,
    cjk_unified_ideographs_extension_h,
    cjk_unified_ideographs_extension_i,
    combining_diacritical_marks,
    combining_diacritical_marks_extended,
    combining_diacritical_marks_for_symbols,
    combining_diacritical_marks_supplement,
    combining_half_marks,
    common_indic_number_forms,
    control_pictures,
    coptic,
    coptic_epact_numbers,
    counting_rod_numerals,
    cuneiform,
    cuneiform_numbers_and_punctuation,
    currency_symbols,
    cypriot_syllabary,
    cypro_minoan,
    cyrillic,
    cyrillic_extended_a,
    cyrillic_extended_b,
    cyrillic_extended_c,
    cyrillic_extended_d,
    cyrillic_supplement,
    deseret,
    devanagari,
    devanagari_extended,
    devanagari_extended_a,
    dingbats,
    dives_akuru,
    dogra,
    domino_tiles,
    duployan,
    early_dynastic_cuneiform,
    egyptian_hieroglyph_format_controls,
    egyptian_hieroglyphs,
    egyptian_hieroglyphs_extended_a,
    elbasan,
    elymaic,
    emoticons,
    enclosed_alphanumeric_supplement,
    enclosed_alphanumerics,
    enclosed_cjk_letters_and_months,
    enclosed_ideographic_supplement,
    ethiopic,
    ethiopic_extended,
    ethiopic_extended_a,
    ethiopic_extended_b,
    ethiopic_supplement,
    garay,
    general_punctuation,
    geometric_shapes,
    geometric_shapes_extended,
    georgian,
    georgian_extended,
    georgian_supplement,
    glagolitic,
    glagolitic_supplement,
    gothic,
    grantha,
    greek_and_coptic,
    greek_extended,
    gujarati,
    gunjala_gondi,
    gurmukhi,
    gurung_khema,
    halfwidth_and_fullwidth_forms,
    hangul_compatibility_jamo,
    hangul_jamo,
    hangul_jamo_extended_a,
    hangul_jamo_extended_b,
    hangul_syllables,
    hanifi_rohingya,
    hanunoo,
    hatran,
    hebrew,
    high_private_use_surrogates,
    high_surrogates,
    hiragana,
    ideographic_description_characters,
    ideographic_symbols_and_punctuation,
    imperial_aramaic,
    indic_siyaq_numbers,
    inscriptional_pahlavi,
    inscriptional_parthian,
    ipa_extensions,
    javanese,
    kaithi,
    kaktovik_numerals,
    kana_extended_a,
    kana_extended_b,
    kana_supplement,
    kanbun,
    kangxi_radicals,
    kannada,
    katakana,
    katakana_phonetic_extensions,
    kawi,
    kayah_li,
    kharoshthi,
    khitan_small_script,
    khmer,
    khmer_symbols,
    khojki,
    khudawadi,
    kirat_rai,
    lao,
    latin_1_supplement,
    latin_extended_a,
    latin_extended_additional,
    latin_extended_b,
    latin_extended_c,
    latin_extended_d,
    latin_extended_e,
    latin_extended_f,
    latin_extended_g,
    lepcha,
    letterlike_symbols,
    limbu,
    linear_a,
    linear_b_ideograms,
    linear_b_syllabary,
    lisu,
    lisu_supplement,
    low_surrogates,
    lycian,
    lydian,
    mahajani,
    mahjong_tiles,
    makasar,
    malayalam,
    mandaic,
    manichaean,
    marchen,
    masaram_gondi,
    mathematical_alphanumeric_symbols,
    mathematical_operators,
    mayan_numerals,
    medefaidrin,
    meetei_mayek,
    meetei_mayek_extensions,
    mende_kikakui,
    meroitic_cursive,
    meroitic_hieroglyphs,
    miao,
    miscellaneous_mathematical_symbols_a,
    miscellaneous_mathematical_symbols_b,
    miscellaneous_symbols,
    miscellaneous_symbols_and_arrows,
    miscellaneous_symbols_and_pictographs,
    miscellaneous_technical,
    modi,
    modifier_tone_letters,
    mongolian,
    mongolian_supplement,
    mro,
    multani,
    musical_symbols,
    myanmar,
    myanmar_extended_a,
    myanmar_extended_b,
    myanmar_extended_c,
    nabataean,
    nag_mundari,
    nandinagari,
    new_tai_lue,
    newa,
    nko,
    number_forms,
    nushu,
    nyiakeng_puachue_hmong,
    ogham,
    ol_chiki,
    ol_onal,
    old_hungarian,
    old_italic,
    old_north_arabian,
    old_permic,
    old_persian,
    old_sogdian,
    old_south_arabian,
    old_turkic,
    old_uyghur,
    optical_character_recognition,
    oriya,
    ornamental_dingbats,
    osage,
    osmanya,
    ottoman_siyaq_numbers,
    pahawh_hmong,
    palmyrene,
    pau_cin_hau,
    phags_pa,
    phaistos_disc,
    phoenician,
    phonetic_extensions,
    phonetic_extensions_supplement,
    playing_cards,
    private_use_area,
    psalter_pahlavi,
    rejang,
    rumi_numeral_symbols,
    runic,
    samaritan,
    saurashtra,
    sharada,
    shavian,
    shorthand_format_controls,
    siddham,
    sinhala,
    sinhala_archaic_numbers,
    small_form_variants,
    small_kana_extension,
    sogdian,
    sora_sompeng,
    soyombo,
    spacing_modifier_letters,
    specials,
    sundanese,
    sundanese_supplement,
    sunuwar,
    superscripts_and_subscripts,
    supplemental_arrows_a,
    supplemental_arrows_b,
    supplemental_arrows_c,
    supplemental_mathematical_operators,
    supplemental_punctuation,
    supplemental_symbols_and_pictographs,
    supplementary_private_use_area_a,
    supplementary_private_use_area_b,
    sutton_signwriting,
    syloti_nagri,
    symbols_and_pictographs_extended_a,
    symbols_for_legacy_computing,
    symbols_for_legacy_computing_supplement,
    syriac,
    syriac_supplement,
    tagalog,
    tagbanwa,
    tags,
    tai_le,
    tai_tham,
    tai_viet,
    tai_xuan_jing_symbols,
    takri,
    tamil,
    tamil_supplement,
    tangsa,
    tangut,
    tangut_components,
    tangut_supplement,
    telugu,
    thaana,
    thai,
    tibetan,
    tifinagh,
    tirhuta,
    todhri,
    toto,
    transport_and_map_symbols,
    tulu_tigalari,
    ugaritic,
    unified_canadian_aboriginal_syllabics,
    unified_canadian_aboriginal_syllabics_extended,
    unified_canadian_aboriginal_syllabics_extended_a,
    vai,
    variation_selectors,
    variation_selectors_supplement,
    vedic_extensions,
    vertical_forms,
    vithkuqi,
    wancho,
    warang_citi,
    yezidi,
    yi_radicals,
    yi_syllables,
    yijing_hexagram_symbols,
    zanabazar_square,
    znamenny_musical_notation,
};

pub const BidiPairedBracket = union(enum) {
    open: u21,
    close: u21,
    none: void,
};

// The following types are internal to `uucode`:

pub fn Field(comptime c: config.Field, comptime packing: config.Table.Packing) type {
    return switch (c.kind()) {
        .slice => if (packing == .unpacked) Slice(c) else unreachable,
        .shift => Shift(c, packing),
        .@"union" => Union(c, packing),
        .optional => if (packing == .unpacked) c.type else PackedOptional(c),
        .basic => c.type,
    };
}

pub fn Data(comptime c: config.Table) type {
    var data_fields: [c.fields.len]std.builtin.Type.StructField = undefined;

    for (c.fields, 0..) |cf, i| {
        const F = Field(cf, c.packing);

        data_fields[i] = .{
            .name = cf.name,
            .type = F,
            .default_value_ptr = null,
            .is_comptime = false,
            .alignment = if (c.packing == .@"packed") 0 else @alignOf(F),
        };
    }

    return @Type(.{
        .@"struct" = .{
            .layout = if (c.packing == .@"packed") .@"packed" else .auto,
            .fields = &data_fields,
            .decls = &[_]std.builtin.Type.Declaration{},
            .is_tuple = false,
        },
    });
}

pub fn writeDataItems(comptime D: type, writer: *std.Io.Writer, data_items: []const D) !void {
    if (@typeInfo(D).@"struct".layout == .@"packed") {
        const IntEquivalent = std.meta.Int(.unsigned, @bitSizeOf(D));

        try writer.print("@bitCast([_]{s}{{\n", .{@typeName(IntEquivalent)});

        for (data_items) |item| {
            try writer.print("{d},", .{@as(IntEquivalent, @bitCast(item))});
        }

        try writer.writeAll(
            \\});
            \\
        );
    } else {
        try writer.writeAll(
            \\.{
            \\
        );

        for (data_items) |item| {
            try writer.writeAll(
                \\.{
                \\
            );

            inline for (@typeInfo(D).@"struct".fields) |field| {
                try writer.print("    .{s} = ", .{field.name});

                try writeDataField(field.type, writer, @field(item, field.name));

                try writer.writeAll(",\n");
            }

            try writer.writeAll(
                \\},
                \\
            );
        }

        try writer.writeAll(
            \\};
            \\
        );
    }
}

pub fn writeDataField(comptime F: type, writer: *std.Io.Writer, field: F) !void {
    switch (@typeInfo(F)) {
        .@"struct" => {
            if (@hasDecl(F, "write")) {
                try field.write(writer);
            } else {
                try writer.print("{}", .{field});
            }
        },
        .@"enum" => {
            try writer.print(".{s}", .{@tagName(field)});
        },
        .optional => {
            try writer.print("{?}", .{field});
        },
        .@"union" => {
            switch (field) {
                inline else => |v, tag| {
                    if (@typeInfo(@TypeOf(v)) == .void) {
                        try writer.print(".{s}", .{@tagName(tag)});
                    } else {
                        try writer.print("{}", .{field});
                    }
                },
            }
        },
        else => {
            try writer.print("{}", .{field});
        },
    }
}

pub fn Backing(comptime D: type) type {
    return StructFromDecls(D, "BackingBuffer");
}

pub fn Table3(
    comptime Data_: type,
    comptime Backing_: type,
) type {
    return struct {
        stage1: []const u16,
        stage2: []const u16,
        stage3: []const Data_,
        backing: *const Backing_,
    };
}

pub fn Table2(
    comptime Data_: type,
    comptime Backing_: type,
) type {
    return struct {
        stage1: []const u16,
        stage2: []const Data_,
        backing: *const Backing_,
    };
}

pub fn StructFromDecls(comptime Struct: type, comptime decl: []const u8) type {
    const fields = @typeInfo(Struct).@"struct".fields;
    var decl_fields: [fields.len]std.builtin.Type.StructField = undefined;
    var i: usize = 0;

    for (@typeInfo(Struct).@"struct".fields) |f| {
        if (@typeInfo(f.type) == .@"struct" and @hasDecl(f.type, decl)) {
            const T = @field(f.type, decl);
            decl_fields[i] = .{
                .name = f.name,
                .type = T,
                .default_value_ptr = null, // TODO: can we set this?
                .is_comptime = false,
                .alignment = @alignOf(T),
            };
            i += 1;
        }
    }

    return @Type(.{
        .@"struct" = .{
            .layout = .auto,
            .fields = decl_fields[0..i],
            .decls = &[_]std.builtin.Type.Declaration{},
            .is_tuple = false,
        },
    });
}

pub fn Slice(
    comptime c: config.Field,
) type {
    const max_len = c.max_len;
    const max_offset = c.max_offset;
    const embedded_len = c.embedded_len;

    if (max_len == 0) {
        @compileError("Slice with max_len == 0 is not supported due to Zig compiler bug");
    }

    if (max_offset == 0 and !(embedded_len == max_len or
        (max_len == 1 and c.cp_packing == .shift)))
    {
        @compileError("Slice with max_offset == 0 is only supported if embedded_len is max_len, or max_len is 1 with shift");
    }

    return struct {
        data: union {
            offset: Offset,
            embedded: [embedded_len]T,
            shift: ShiftSingleItem,
        },
        len: Len,

        const Self = @This();
        pub const T = @typeInfo(c.type).pointer.child;
        const Offset = std.math.IntFittingRange(0, max_offset);
        const ShiftSingleItem = if (c.cp_packing == .shift) Shift(c, .unpacked) else void;
        const Len = std.math.IntFittingRange(0, max_len);

        pub const Tracking = SliceTracking(T, max_len);
        pub const BackingBuffer = []const T;
        pub const MutableBackingBuffer = []T;
        pub const empty = Self{ .len = 0, .data = .{ .offset = 0 } };

        inline fn _init(
            allocator: Allocator,
            backing: []T,
            tracking: *Tracking,
            s: []const T,
        ) Allocator.Error!Self {
            tracking.max_len = @max(tracking.max_len, s.len);

            if ((comptime embedded_len == 0) or s.len > embedded_len) {
                if (s.len == 0) {
                    return .empty;
                }

                const len: Len = @intCast(s.len);
                const gop = try tracking.offset_map.getOrPut(allocator, s);

                if (gop.found_existing) {
                    return .{
                        .len = len,
                        .data = .{
                            .offset = @intCast(gop.value_ptr.*),
                        },
                    };
                }

                const offset = tracking.max_offset;
                gop.value_ptr.* = offset;
                @memcpy(backing[offset .. offset + s.len], s);
                gop.key_ptr.* = backing[offset .. offset + s.len];
                tracking.len_counts[s.len - 1] += 1;
                tracking.max_offset += s.len;

                return .{
                    .len = len,
                    .data = .{
                        .offset = @intCast(offset),
                    },
                };
            } else {
                var embedded: [embedded_len]T = undefined;
                @memcpy(embedded[0..s.len], s);
                switch (@typeInfo(T)) {
                    .@"struct" => {
                        @memset(embedded[s.len..], 0);
                    },
                    .@"enum" => {
                        @memset(embedded[s.len..], @enumFromInt(0));
                    },
                    else => {
                        @memset(embedded[s.len..], 0);
                    },
                }

                return .{
                    .len = @intCast(s.len),
                    .data = .{
                        .embedded = embedded,
                    },
                };
            }
        }

        pub fn init(
            allocator: Allocator,
            backing: []T,
            tracking: *Tracking,
            s: []const T,
        ) Allocator.Error!Self {
            if (c.cp_packing != .direct) {
                @compileError("init is only supported for direct packing: use initFor instead");
            }

            return ._init(allocator, backing, tracking, s);
        }

        pub fn initFor(
            allocator: Allocator,
            backing: []T,
            tracking: *Tracking,
            s: []const T,
            cp: u21,
        ) Allocator.Error!Self {
            if (s.len == 1) {
                tracking.shift.track(cp, s[0]);
            }

            if (c.cp_packing == .shift and s.len == 1) {
                tracking.max_len = @max(tracking.max_len, 1);

                return .{
                    .len = 1,
                    .data = .{
                        .shift = .init(cp, s[0]),
                    },
                };
            } else {
                return ._init(allocator, backing, tracking, s);
            }
        }

        fn _slice(
            self: *const Self,
            backing: []const T,
        ) []const T {
            // Repeat the two return cases, first with two `comptime` checks,
            // then with a runtime if/else
            if (comptime embedded_len == max_len) {
                return self.data.embedded[0..self.len];
            } else if (comptime embedded_len == 0) {
                return backing[self.data.offset .. @as(usize, self.data.offset) + @as(usize, self.len)];
            } else if (self.len <= embedded_len) {
                return self.data.embedded[0..self.len];
            } else {
                return backing[self.data.offset .. @as(usize, self.data.offset) + @as(usize, self.len)];
            }
        }

        pub fn sliceWith(
            self: *const Self,
            backing: []const T,
            single_item_buffer: *[1]T,
            cp: u21,
        ) []const T {
            if (c.cp_packing == .shift and self.len == 1) {
                single_item_buffer[0] = self.data.shift.unshift(cp);
                return single_item_buffer[0..1];
            } else {
                return self._slice(backing);
            }
        }

        pub const slice = if (c.cp_packing == .direct)
            _slice
        else
            void{};

        // Note: while it would be better for modularity to pass `backing`
        // in, this makes for a nicer API without having to wrap Slice.
        const hardcoded_backing = @import("./get.zig").backingFor(c.name);

        fn _value(self: *const Self) []const T {
            return self._slice(hardcoded_backing);
        }

        pub fn with(
            self: *const Self,
            single_item_buffer: *[1]T,
            cp: u21,
        ) []const T {
            return self.sliceWith(hardcoded_backing, single_item_buffer, cp);
        }

        pub const value = if (c.cp_packing == .direct)
            _value
        else
            void{};

        pub fn autoHash(self: Self, hasher: anytype) void {
            // Repeat the two return cases, first with two `comptime` checks,
            // then with a runtime if/else
            std.hash.autoHash(hasher, self.len);
            if ((comptime c.cp_packing == .shift) and self.len == 1) {
                std.hash.autoHash(hasher, self.data.shift);
            } else if ((comptime embedded_len == 0) or self.len > embedded_len) {
                std.hash.autoHash(hasher, self.data.offset);
            } else {
                std.hash.autoHash(hasher, self.data.embedded);
            }
        }

        pub fn eql(a: Self, b: Self) bool {
            if (a.len != b.len) {
                return false;
            }
            if ((comptime c.cp_packing == .shift) and a.len == 1) {
                return a.data.shift.eql(b.data.shift);
            } else if ((comptime embedded_len == 0) or a.len > embedded_len) {
                return a.data.offset == b.data.offset;
            } else {
                return std.mem.eql(T, &a.data.embedded, &b.data.embedded);
            }
        }

        pub fn write(self: Self, writer: *std.Io.Writer) !void {
            try writer.print(
                \\.{{
                \\    .len = {},
                \\
            , .{self.len});

            if ((comptime c.cp_packing == .shift) and self.len == 1) {
                try writer.writeAll("    .data = .{ .shift = ");
                try self.data.shift.write(writer);
                try writer.writeAll("},\n");
            } else if ((comptime embedded_len == 0) or self.len > embedded_len) {
                try writer.print(
                    \\    .data = .{{ .offset = {} }},
                    \\
                , .{self.data.offset});
            } else {
                try writer.writeAll(
                    \\    .data = .{ .embedded = .{
                );
                for (self.data.embedded) |item| {
                    try writeDataField(T, writer, item);
                    try writer.writeAll(",");
                }
                try writer.writeAll(
                    \\} },
                    \\
                );
            }

            try writer.writeAll(
                \\}
                \\
            );
        }
    };
}

pub fn SliceTracking(comptime T: type, comptime max_len: usize) type {
    return struct {
        max_offset: usize = 0,
        max_len: usize = 0,
        offset_map: SliceMap(T, usize) = .empty,
        len_counts: [max_len]usize = [_]usize{0} ** max_len,
        shift: ShiftTracking = .{},

        const Self = @This();

        pub fn deinit(self: *Self, allocator: Allocator) void {
            self.offset_map.deinit(allocator);
        }

        pub fn actualConfig(
            self: *const Self,
            c: config.Field.Runtime,
        ) config.Field.Runtime {
            return c.override(.{
                .shift_low = self.shift.shift_low,
                .shift_high = self.shift.shift_high,
                .max_len = self.max_len,
                .max_offset = self.max_offset,
            });
        }

        pub fn minBitsConfig(
            self: *const Self,
            c: config.Field.Runtime,
        ) config.Field.Runtime {
            if (c.embedded_len != 0) {
                @panic("embedded_len != 0 is not supported for minBitsConfig");
            }

            const actual = self.actualConfig(c);

            // In case of everything fitting in shift, return early
            // to avoid log2_int error.
            if (actual.max_len == 1 and self.len_counts[0] == 0) {
                return actual;
            }

            const item_bits = @bitSizeOf(T);
            var best_embedded_len: usize = actual.max_len;
            var best_max_offset: usize = 0;
            var best_bits = best_embedded_len * item_bits;
            var current_max_offset: usize = 0;

            var i: usize = actual.max_len;
            while (i != 0) {
                i -= 1;
                current_max_offset += (i + 1) * self.len_counts[i];

                const embedded_bits = i * item_bits;

                // We do over-estimate the max offset a bit by taking the
                // offset _after_ the last item, since we don't know what
                // the last item will be. This simplifies creating backing
                // buffers of length `max_offset`.
                const offset_bits = std.math.log2_int(usize, current_max_offset);
                const bits = @max(offset_bits, embedded_bits);

                if (bits < best_bits or (bits == best_bits and current_max_offset <= best_max_offset)) {
                    best_embedded_len = i;
                    best_max_offset = current_max_offset;
                    best_bits = bits;
                }
            }

            std.debug.assert(current_max_offset == self.max_offset);

            return c.override(.{
                .shift_low = actual.shift_low,
                .shift_high = actual.shift_high,
                .max_len = actual.max_len,
                .max_offset = best_max_offset,
                .embedded_len = best_embedded_len,
            });
        }
    };
}

pub const ShiftTracking = struct {
    shift_low: isize = 0,
    shift_high: isize = 0,

    pub fn deinit(self: *ShiftTracking, allocator: Allocator) void {
        _ = self;
        _ = allocator;
    }

    pub fn track(self: *ShiftTracking, cp: u21, opt: ?u21) void {
        if (opt) |d| {
            const shift = @as(isize, d) - @as(isize, cp);
            if (self.shift_high < shift) {
                self.shift_high = shift;
            } else if (shift < self.shift_low) {
                self.shift_low = shift;
            }
        }
    }

    pub fn actualConfig(self: *const ShiftTracking, c: config.Field.Runtime) config.Field.Runtime {
        return c.override(.{
            .shift_low = self.shift_low,
            .shift_high = self.shift_high,
        });
    }

    pub fn minBitsConfig(self: *const ShiftTracking, c: config.Field.Runtime) config.Field.Runtime {
        return self.actualConfig(c);
    }
};

pub const UnionShiftTracking = struct {
    shift: ShiftTracking = .{},

    pub fn deinit(self: *UnionShiftTracking, allocator: Allocator) void {
        _ = self;
        _ = allocator;
    }

    pub fn track(self: *UnionShiftTracking, cp: u21, value: anytype) void {
        switch (value) {
            inline else => |v| if (@TypeOf(v) == u21) self.shift.track(cp, v),
        }
    }

    pub fn actualConfig(self: *const UnionShiftTracking, c: config.Field.Runtime) config.Field.Runtime {
        return self.shift.actualConfig(c);
    }

    pub fn minBitsConfig(self: *const UnionShiftTracking, c: config.Field.Runtime) config.Field.Runtime {
        return self.shift.minBitsConfig(c);
    }
};

pub fn SliceMap(comptime T: type, comptime V: type) type {
    return std.HashMapUnmanaged([]const T, V, struct {
        pub fn hash(self: @This(), s: []const T) u64 {
            _ = self;
            var hasher = std.hash.Wyhash.init(718259503);
            std.hash.autoHashStrat(&hasher, s, .Deep);
            const result = hasher.final();
            return result;
        }
        pub fn eql(self: @This(), a: []const T, b: []const T) bool {
            _ = self;
            return std.mem.eql(T, a, b);
        }
    }, std.hash_map.default_max_load_percentage);
}

pub fn PackedOptional(comptime c: config.Field) type {
    if (c.min_value == 0 and c.max_value == 0) {
        @compileError("PackedOptional with min_value = 0 and max_value = 0. Set to minInt(isize), maxInt(isize) - 1 and run again to get actual values");
    }

    return packed struct {
        data: Int,

        const Self = @This();
        pub const Tracking = OptionalTracking(c.type);
        const T = @typeInfo(c.type).optional.child;
        const Int = std.math.IntFittingRange(c.min_value, c.max_value + 1);
        const null_data = std.math.maxInt(Int);
        pub const @"null" = Self{ .data = null_data };

        pub fn init(opt: ?T) Self {
            if (opt) |value| {
                const d: Int = switch (@typeInfo(T)) {
                    .int => value,
                    .@"enum" => @intFromEnum(value),
                    .bool => @intFromBool(value),
                    else => unreachable,
                };
                std.debug.assert(d != null_data);
                return .{ .data = d };
            } else {
                return .null;
            }
        }

        pub fn unpack(self: Self) ?T {
            if (self.data == null_data) {
                return null;
            } else {
                return switch (@typeInfo(T)) {
                    .int => @intCast(self.data),
                    .@"enum" => @enumFromInt(self.data),
                    .bool => self.data == 1,
                    else => unreachable,
                };
            }
        }
    };
}

pub fn OptionalTracking(comptime Optional: type) type {
    return struct {
        min_value: isize = 0,
        max_value: isize = 0,

        const Self = @This();
        const T = @typeInfo(Optional).optional.child;

        pub fn deinit(self: *Self, allocator: Allocator) void {
            _ = self;
            _ = allocator;
        }

        pub fn track(self: *Self, opt: ?T) void {
            if (opt) |value| {
                const d: isize = switch (@typeInfo(T)) {
                    .int => value,
                    .@"enum" => @intFromEnum(value),
                    .bool => @intFromBool(value),
                    else => unreachable,
                };
                if (self.max_value < d) {
                    self.max_value = d;
                } else if (d < self.min_value) {
                    self.min_value = d;
                }
            }
        }

        pub fn actualConfig(self: *const Self, c: config.Field.Runtime) config.Field.Runtime {
            return c.override(.{
                .min_value = self.min_value,
                .max_value = self.max_value,
            });
        }

        pub fn minBitsConfig(self: *const Self, c: config.Field.Runtime) config.Field.Runtime {
            return self.actualConfig(c);
        }
    };
}

pub fn Shift(comptime c: config.Field, comptime packing: config.Table.Packing) type {
    const is_optional = @typeInfo(c.type) == .optional;

    if (c.kind() == .shift and !((is_optional and @typeInfo(c.type).optional.child == u21) or
        c.type == u21))
    {
        @compileError("Shift field '" ++ c.name ++ "' must be type u21 or ?u21");
    }

    if (c.kind() == .slice and @typeInfo(c.type).pointer.child != u21) {
        @compileError("Slice field '" ++ c.name ++ "' must be type []const u21");
    }

    const Int = std.math.IntFittingRange(c.shift_low, c.shift_high + @intFromBool(is_optional));
    // Only valid if `is_optional`
    const null_data = std.math.maxInt(Int);

    return if (packing == .unpacked) struct {
        data: Int,

        const Self = @This();
        pub const Tracking = ShiftTracking;
        pub const @"null" = Self{ .data = null_data };

        pub fn init(cp: u21, d: u21) Self {
            return Self{ .data = @intCast(@as(isize, d) - @as(isize, cp)) };
        }

        pub fn initOptional(cp: u21, o: ?u21) Self {
            if (o) |d| {
                return .init(cp, d);
            } else {
                return .null;
            }
        }

        fn _unshift(self: Self, cp: u21) u21 {
            return @intCast(@as(isize, cp) + @as(isize, self.data));
        }

        fn _unshiftOptional(self: Self, cp: u21) ?u21 {
            if (self.data == null_data) {
                return null;
            } else {
                return self._unshift(cp);
            }
        }

        pub const unshift = if (is_optional)
            _unshiftOptional
        else
            _unshift;

        pub fn eql(a: Self, b: Self) bool {
            return a.data == b.data;
        }

        pub fn write(self: Self, writer: *std.Io.Writer) !void {
            try writer.print(
                \\.{{
                \\    .data = {},
                \\}}
                \\
            , .{self.data});
        }
    } else packed struct {
        data: Int,

        const Self = @This();
        pub const Tracking = ShiftTracking;
        pub const @"null" = Self{ .data = null_data };

        pub fn init(cp: u21, d: u21) Self {
            return Self{ .data = @intCast(@as(isize, d) - @as(isize, cp)) };
        }

        pub fn initOptional(cp: u21, o: ?u21) Self {
            if (o) |d| {
                return .init(cp, d);
            } else {
                return .null;
            }
        }

        fn _unshift(self: Self, cp: u21) u21 {
            return @intCast(@as(isize, cp) + @as(isize, self.data));
        }

        fn _unshiftOptional(self: Self, cp: u21) ?u21 {
            if (self.data == null_data) {
                return null;
            } else {
                return self._unshift(cp);
            }
        }

        pub const unshift = if (is_optional)
            _unshiftOptional
        else
            _unshift;
    };
}

pub fn Union(comptime c: config.Field, comptime packing: config.Table.Packing) type {
    if (packing == .unpacked and c.cp_packing == .direct) {
        return c.type;
    }

    const info = @typeInfo(c.type).@"union";
    const Tag = info.tag_type.?;
    const Int = @typeInfo(Tag).@"enum".tag_type;
    std.debug.assert(Int == std.meta.Int(.unsigned, @bitSizeOf(Tag)));

    const ShiftMember = if (c.cp_packing == .shift) Shift(c, packing) else void;

    var fields: [info.fields.len]std.builtin.Type.UnionField = undefined;
    var has_shift: bool = false;
    for (info.fields, 0..) |f, i| {
        const T = if (c.cp_packing == .shift and f.type == u21) blk: {
            has_shift = true;
            break :blk ShiftMember;
        } else f.type;
        fields[i] = .{
            .name = f.name,
            .type = T,
            .alignment = if (packing == .@"packed") 0 else @alignOf(T),
        };
    }

    if (c.cp_packing == .shift and !has_shift) {
        @compileError("Shift can only be used in unions with at least one field of type u21");
    }

    const InnerUnion = @Type(.{
        .@"union" = .{
            .layout = if (packing == .@"packed") .@"packed" else .auto,
            .tag_type = if (packing == .@"packed") null else Tag,
            .fields = &fields,
            .decls = &[_]std.builtin.Type.Declaration{},
        },
    });

    return if (packing == .unpacked) struct {
        @"union": InnerUnion,

        const Self = @This();
        pub const Tracking = UnionShiftTracking;

        pub fn init(cp: u21, value: c.type) Self {
            return .{
                .@"union" = switch (value) {
                    inline else => |v, tag| if (@FieldType(InnerUnion, @tagName(tag)) == ShiftMember)
                        @unionInit(InnerUnion, @tagName(tag), .init(cp, v))
                    else
                        @unionInit(InnerUnion, @tagName(tag), v),
                },
            };
        }

        pub fn unshift(self: Self, cp: u21) c.type {
            return switch (self.@"union") {
                inline else => |v, comptime_tag| if (@FieldType(InnerUnion, @tagName(comptime_tag)) == ShiftMember)
                    @unionInit(
                        c.type,
                        @tagName(comptime_tag),
                        v.unshift(cp),
                    )
                else
                    @unionInit(
                        c.type,
                        @tagName(comptime_tag),
                        v,
                    ),
            };
        }

        pub fn write(self: Self, writer: *std.Io.Writer) !void {
            try writer.writeAll(
                \\.{
                \\    .@"union" =
            );
            try writer.writeAll(" ");
            try writeDataField(InnerUnion, writer, self.@"union");
            try writer.writeAll(
                \\,
                \\}
                \\
            );
        }
    } else packed struct {
        tag: Int,
        @"union": InnerUnion,

        const Self = @This();

        fn _init(value: c.type) Self {
            return .{
                .tag = @intFromEnum(@as(Tag, value)),
                .@"union" = switch (value) {
                    inline else => |v, tag| @unionInit(InnerUnion, @tagName(tag), v),
                },
            };
        }

        fn _initShift(cp: u21, value: c.type) Self {
            return .{
                .tag = @intFromEnum(@as(Tag, value)),
                .@"union" = switch (value) {
                    inline else => |v, tag| if (@FieldType(InnerUnion, @tagName(tag)) == ShiftMember)
                        @unionInit(InnerUnion, @tagName(tag), .init(cp, v))
                    else
                        @unionInit(InnerUnion, @tagName(tag), v),
                },
            };
        }

        fn _unpack(self: Self) c.type {
            const tag: Tag = @enumFromInt(self.tag);
            return switch (tag) {
                inline else => |comptime_tag| @unionInit(
                    c.type,
                    @tagName(comptime_tag),
                    @field(self.@"union", @tagName(comptime_tag)),
                ),
            };
        }

        fn _unshift(self: Self, cp: u21) c.type {
            const tag: Tag = @enumFromInt(self.tag);
            return switch (tag) {
                inline else => |comptime_tag| if (@FieldType(InnerUnion, @tagName(comptime_tag)) == ShiftMember)
                    @unionInit(
                        c.type,
                        @tagName(comptime_tag),
                        @field(self.@"union", @tagName(comptime_tag)).unshift(cp),
                    )
                else
                    @unionInit(
                        c.type,
                        @tagName(comptime_tag),
                        @field(self.@"union", @tagName(comptime_tag)),
                    ),
            };
        }

        pub const Tracking = if (c.cp_packing == .shift) UnionShiftTracking else void;
        pub const init = if (c.cp_packing == .shift) _initShift else _init;
        pub const unpack = if (c.cp_packing == .shift) void{} else _unpack;
        pub const unshift = if (c.cp_packing == .shift) _unshift else void{};

        pub fn autoHash(self: Self, hasher: anytype) void {
            const tag: Tag = @enumFromInt(self.tag);
            std.hash.autoHash(hasher, tag);
            switch (tag) {
                inline else => |comptime_tag| {
                    std.hash.autoHash(
                        hasher,
                        @field(self.@"union", @tagName(comptime_tag)),
                    );
                },
            }
        }

        pub fn eql(a: Self, b: Self) bool {
            if (a.tag != b.tag) {
                return false;
            }
            const tag: Tag = @enumFromInt(a.tag);
            switch (tag) {
                inline else => |comptime_tag| {
                    const a_v = @field(a.@"union", @tagName(comptime_tag));
                    const b_v = @field(b.@"union", @tagName(comptime_tag));
                    return std.meta.eql(a_v, b_v);
                },
            }
        }
    };
}

/// This is used in build/tables.zig but is exposed to allow extension to use
/// it as well. Use this to initialize non-slice fields, and use
/// `sliceFieldInit` for slice fields.
pub fn fieldInit(
    comptime field: []const u8,
    cp: u21,
    data: anytype,
    tracking: anytype,
    d: anytype,
) void {
    const F = @FieldType(@typeInfo(@TypeOf(data)).pointer.child, field);
    if (@typeInfo(F) == .@"struct" and @hasDecl(F, "unshift") and @TypeOf(F.unshift) != void) {
        if (@typeInfo(@TypeOf(d)) == .optional) {
            @field(data, field) = .initOptional(
                cp,
                d,
            );
        } else {
            @field(data, field) = .init(
                cp,
                d,
            );
        }
    } else if (@typeInfo(F) == .@"struct" and @hasDecl(F, "unpack")) {
        @field(data, field) = .init(d);
    } else {
        @field(data, field) = d;
    }
    const Tracking = @typeInfo(@TypeOf(tracking)).pointer.child;
    if (@hasField(Tracking, field)) {
        if (@typeInfo(@TypeOf(@FieldType(Tracking, field).track)).@"fn".params.len == 3) {
            @field(tracking, field).track(cp, d);
        } else {
            @field(tracking, field).track(d);
        }
    }
}

/// This is used in build/tables.zig but is exposed to allow extension to use
/// it as well. Use this to initialize "var len" fields.
pub fn sliceFieldInit(
    comptime field: []const u8,
    allocator: Allocator,
    cp: u21,
    data: anytype,
    backing: anytype,
    tracking: anytype,
    d: anytype,
) Allocator.Error!void {
    const F = @FieldType(@typeInfo(@TypeOf(data)).pointer.child, field);
    if (F.T == u21) {
        @field(data, field) = try .initFor(
            allocator,
            @field(backing, field),
            &@field(tracking, field),
            d,
            cp,
        );
    } else {
        @field(data, field) = try .init(
            allocator,
            @field(backing, field),
            &@field(tracking, field),
            d,
        );
    }
}

const config = @import("./config.zig");
const std = @import("std");
const Allocator = std.mem.Allocator;
