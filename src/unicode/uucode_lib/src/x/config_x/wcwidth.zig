//! The `wcwidth` is a calculation of the expected width of a code point in
//! cells of a monospaced font. It is not part of the Unicode standard.
//!
//! IMPORTANT: in general, calculate the width of a grapheme cluster with
//! `uucode.x.grapheme.wcwidth(it)` instead of using this `wcwidth`
//! directly. If it's already known that a code point is standing alone and not
//! part of a multiple-code-point grapheme cluster, it's acceptable to use
//! `wcwidth_standalone` directly.
//!
//! This `wcwidth` calculates two related values:
//!
//! * `wcwidth_standalone`:` The width for a code point as it would display
//!   **standing alone** without being combined with other code point in a
//!   grapheme cluster. Put another way, this is the width of a grapheme
//!   cluster consisting of only this code point. For some code points, it is
//!   rare or even technically "invalid" to be alone in a grapheme cluster but
//!   despite that, we provide a width for them. See `wcwidth` in
//!   `src/x/grapheme.zig` for the code and documentation for determining the
//!   width of a grapheme cluster that may contain multiple code points, and
//!   not how it uses this `wcwidth_standalone` when there is only one code
//!   point.
//!
//! * `wcwidth_zero_in_grapheme`: This indicates whether a code point does not
//!   contribute to width within a grapheme cluster, even if the code point
//!   might have width when standing alone (`wcwidth_standalone`). Emoji
//!   modifiers, nonspacing and enclosing marks, and Hangul/Kirat V/T are all
//!   in this category.
//!
//! See resources/wcwidth for other implementations, that help to inform the
//! implementation here.
//!
//! This implementation makes the following choices:
//!
//! * The returned width is never negative. C0 and C1 control characters are
//!   treated as zero width, diverging from some implementations that return
//!   -1.
//!
//! * When a combining mark (Mn, Mc, Me) stands alone (not preceded by a base
//!   character), it forms a "defective combining character sequence" (Core Spec
//!   3.6,
//!   https://www.unicode.org/versions/Unicode17.0.0/core-spec/chapter-3/#G20665).
//!   Per Core Spec 5.13: "Defective combining character sequences should be
//!   rendered as if they had a no-break space as a base character"
//!   (https://www.unicode.org/versions/Unicode17.0.0/core-spec/chapter-5/#G1099).
//!   Therefore, `wcwidth_standalone` is given a width of 1.
//!
//!   Note: Per UAX #44, nonspacing marks (Mn) have "zero advance width" while
//!   spacing marks (Mc) have "positive advance width"
//!   (https://www.unicode.org/reports/tr44/#General_Category_Values).
//!   Enclosing marks (Me) are not explicitly specified, but in terminal
//!   rendering contexts they behave similarly to nonspacing marks. See also
//!   Core Spec 2.11, "Nonspacing combining characters do not occupy a spacing
//!   position by themselves"
//!   (https://www.unicode.org/versions/Unicode17.0.0/core-spec/chapter-2/#G1789).
//!   Therefore, `wcwidth_zero_in_grapheme` is true for nonspacing marks (Mn)
//!   and enclosing marks (Me).
//!
//! * East Asian Width (UAX #11, https://www.unicode.org/reports/tr11/) is used
//!   to determine width, but only as a starting point. UAX #11 warns that
//!   East_Asian_Width "is not intended for use by modern terminal emulators
//!   without appropriate tailoring" (UAX #11 §2,
//!   https://www.unicode.org/reports/tr11/#Scope). This implementation applies
//!   tailoring for specific cases such as regional indicators.
//!
//!   Ambiguous width (A) characters are treated as width 1. Per UAX #11 §5
//!   Recommendations: "If the context cannot be established reliably, they
//!   should be treated as narrow characters by default"
//!   (https://www.unicode.org/reports/tr11/#Recommendations), and per UAX #11
//!   §4.2 Ambiguous Characters: "Modern practice is evolving toward rendering
//!   ever more of the ambiguous characters with proportionally spaced, narrow
//!   forms that rotate with the direction of writing, independent of their
//!   treatment in one or more legacy character sets."
//!
//! * U+20E3 COMBINING ENCLOSING KEYCAP is commonly used in emoji keycap
//!   sequences like 1️⃣ (digit + VS16 + U+20E3), but when standing alone might
//!   render as an empty keycap symbol visually occupying 2 cells, so sit is
//!   given width 2. This is a special case—other enclosing marks like U+20DD
//!   COMBINING ENCLOSING CIRCLE are width 1. UTS #51 §1.4.6 ED-20 states
//!   "Other components (U+20E3 COMBINING ENCLOSING KEYCAP, ...) should never
//!   have an emoji presentation in isolation"
//!   (https://www.unicode.org/reports/tr51/#def_basic_emoji_set), so this
//!   should display with text presentation standing alone. For
//!   `wcwidth_zero_in_grapheme`, it is true, as it should usually follow VS16
//!   preceded by a digit or '#', and so the entire keycap sequence will be a
//!   width of 2 from the special VS16 handling.
//!
//! * Regional indicator symbols (U+1F1E6..U+1F1FF) are treated as width 2,
//!   whether paired in valid emoji flag sequences or standing alone. Per UTS #51
//!   §1.5 Conformance: "A singleton emoji Regional Indicator may be displayed
//!   as a capital A..Z character with a special display"
//!   (https://www.unicode.org/reports/tr51/#C3). Unpaired regional indicators
//!   commonly render as the corresponding letter in a width-2 box (e.g., 🇺
//!   displays as "U" in a box). See the above bullet point (U+20E3) for the
//!   text from UTS #51 §1.4.6 ED-20 that also applies to regional indicators,
//!   meaning they should have a text presentation in isolation.
//!
//! * Default_Ignorable_Code_Point characters are treated as width 0. These are
//!   characters that "should be ignored in rendering (unless explicitly
//!   supported)" (UAX #44,
//!   https://www.unicode.org/reports/tr44/#Default_Ignorable_Code_Point). This
//!   includes variation selectors, join controls (ZWJ/ZWNJ), bidi formatting
//!   controls, tag characters, and other invisible format controls.
//!
//!   Exception: U+00AD SOFT HYPHEN is treated as width 1 for terminal
//!   compatibility despite being default-ignorable. Per the Unicode FAQ: "In a
//!   terminal emulation environment, particularly in ISO-8859-1 contexts, one
//!   could display the SOFT HYPHEN as a hyphen in all circumstances"
//!   (https://www.unicode.org/faq/casemap_charprop.html). Terminals lack
//!   sophisticated word-breaking algorithms and typically display SOFT HYPHEN as
//!   a visible hyphen, requiring width 1. This matches ecosystem wcwidth
//!   implementations.
//!
//!   VS15 and VS16 have `wcwidth_zero_in_grapheme` set to true. These are not
//!   "zero in grapheme" in the sense that they don't affect width--they change
//!   the width of the base char! But they don't have their *own* independent
//!   width contribution that should be summed. They are special cased in the
//!   `x/grapheme.zig` `wcwidth` calculation.
//!
//! * Hangul Jamo medial vowels and Kirat Rai vowels (all
//!   Grapheme_Cluster_Break=V) and Hangul trailing consonants
//!   (Grapheme_Cluster_Break=T) are width 1 for wcwidth_standalone since they
//!   are General_Category=Other_Letter with East_Asian_Width=Neutral. However,
//!   `wcwidth_zero_in_grapheme` is true for these, as they should only be
//!   present in a grapheme cluster where the other code points contribute to
//!   the width.
//!
//! * Surrogates (General_Category=Cs, U+D800..U+DFFF) are treated as width 0.
//!   They are not Unicode scalar values (Core Spec 3.9,
//!   https://www.unicode.org/versions/Unicode17.0.0/core-spec/chapter-3/#G25539)
//!   and "are designated for surrogate code units in the UTF-16 character
//!   encoding form. They are unassigned to any abstract character." (Core Spec
//!   3.2.1 C1,
//!   https://www.unicode.org/versions/Unicode17.0.0/core-spec/chapter-3/#G22599).
//!
//! * U+2028 LINE SEPARATOR (Zl) and U+2029 PARAGRAPH SEPARATOR (Zp) are
//!   treated as width 0. They introduce mandatory line/paragraph breaks (UAX
//!   #14, Line_Break=BK, https://www.unicode.org/reports/tr14/#BK) and do not
//!   advance horizontally on the same line.
//!
//! * Emoji modifiers (Fitzpatrick skin tone modifiers U+1F3FB..U+1F3FF) have
//!   `wcwidth_standalone` = 2, as when standing alone they render as fullwidth
//!   colored squares (and are marked East_Asian_Width=W) However,
//!   `wcwidth_zero_in_grapheme` is true, as they are typically used to modify a
//!   base emoji which contributes the width.
//!

fn compute(
    allocator: std.mem.Allocator,
    cp: u21,
    data: anytype,
    backing: anytype,
    tracking: anytype,
) std.mem.Allocator.Error!void {
    _ = allocator;
    _ = backing;
    _ = tracking;
    const gc = data.general_category;

    var width: u2 = undefined;

    if (gc == .other_control or
        gc == .other_surrogate or
        gc == .separator_line or
        gc == .separator_paragraph)
    {
        width = 0;
    } else if (cp == 0x00AD) { // Soft hyphen
        width = 1;
    } else if (data.is_default_ignorable) {
        width = 0;
    } else if (cp == 0x2E3A) { // Two-em dash
        width = 2;
    } else if (cp == 0x2E3B) { // Three-em dash
        width = 3;
    } else if (data.east_asian_width == .wide or data.east_asian_width == .fullwidth) {
        width = 2;
    } else if (data.grapheme_break == .regional_indicator) {
        width = 2;
    } else {
        width = 1;
    }

    const Data = @TypeOf(data.*);
    if (@hasField(Data, "wcwidth_standalone")) {
        if (cp == 0x20E3) { // Combining enclosing keycap
            data.wcwidth_standalone = 2;
        } else {
            data.wcwidth_standalone = width;
        }
    }
    if (@hasField(Data, "wcwidth_zero_in_grapheme")) {
        if (width == 0 or // Includes default_ignorable such as ZWJ and VS
            data.is_emoji_modifier or
            gc == .mark_nonspacing or
            gc == .mark_enclosing or // Including keycap
            data.grapheme_break == .v or // Hangul Jamo and Kirat Rai vowels
            data.grapheme_break == .t // Hangul trailing consonants
        ) {
            data.wcwidth_zero_in_grapheme = true;
        } else {
            data.wcwidth_zero_in_grapheme = false;
        }
    }
}

pub const wcwidth = config.Extension{
    .inputs = &.{
        "east_asian_width",
        "general_category",
        "grapheme_break",
        "is_default_ignorable",
        "is_emoji_modifier",
    },
    .compute = &compute,
    .fields = &.{
        .{ .name = "wcwidth_standalone", .type = u2 },
        .{ .name = "wcwidth_zero_in_grapheme", .type = bool },
    },
};

const config = @import("./config.zig");
const std = @import("std");
