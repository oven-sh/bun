pub const GraphemeBreakNoControl = enum(u5) {
    other,
    prepend,
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
