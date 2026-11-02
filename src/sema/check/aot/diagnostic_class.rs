#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
#[repr(u8)]
pub enum DiagnosticClass {
    #[default]
    EarlyError,
    TypeScriptGrammar,
    Semantic,
    MissingDeclaration,
    Style,
    DeclarationFile,
    EmittedOutput,
}

const MISSING_DECLARATION_CODES: [u32; 42] = [
    2304, 2307, 2311, 2318, 2468, 2503, 2550, 2552, 2580, 2581, 2582, 2583, 2584, 2585, 2591, 2592,
    2593, 2662, 2663, 2664, 2665, 2688, 2694, 2726, 2727, 2732, 2812, 2833, 2834, 2835, 2867, 2868,
    2874, 2875, 2879, 2882, 6053, 6263, 6305, 7016, 7042, 18004,
];

const MODULE_SYNTAX_CODES: [u32; 27] = [
    1205, 1269, 1272, 1280, 1281, 1282, 1283, 1284, 1285, 1286, 1287, 1288, 1289, 1290, 1291, 1292,
    1293, 1294, 1295, 1448, 1484, 1485, 2748, 2865, 2866, 18055, 18056,
];

const EMITTED_OUTPUT_CODES: [u32; 27] = [
    1202, 1203, 1218, 1309, 1323, 1324, 1343, 1378, 1432, 1470, 1471, 1479, 1541, 1542, 1543, 1544,
    2343, 2354, 2725, 2807, 2823, 2854, 2856, 6142, 6307, 17004, 18057,
];

const STYLE_CODES: [u32; 67] = [
    1313, 1345, 2564, 2578, 2683, 2774, 2801, 2845, 2869, 2871, 2872, 2873, 4111, 4112, 4113, 4114,
    4115, 4116, 4117, 4119, 4120, 4121, 4122, 4123, 4127, 4128, 6133, 6138, 6192, 6196, 6198, 6199,
    6205, 7005, 7006, 7008, 7009, 7010, 7011, 7012, 7013, 7015, 7017, 7018, 7019, 7020, 7022, 7023,
    7024, 7025, 7026, 7027, 7028, 7029, 7030, 7031, 7032, 7033, 7034, 7039, 7041, 7051, 7052, 7053,
    7054, 7055, 7057,
];

impl DiagnosticClass {
    pub const COUNT: usize = 7;
    pub const ALL: [DiagnosticClass; DiagnosticClass::COUNT] = [
        DiagnosticClass::EarlyError,
        DiagnosticClass::TypeScriptGrammar,
        DiagnosticClass::Semantic,
        DiagnosticClass::MissingDeclaration,
        DiagnosticClass::Style,
        DiagnosticClass::DeclarationFile,
        DiagnosticClass::EmittedOutput,
    ];

    pub fn of_code(code: u32) -> DiagnosticClass {
        if STYLE_CODES.binary_search(&code).is_ok() {
            DiagnosticClass::Style
        } else if MISSING_DECLARATION_CODES.binary_search(&code).is_ok() {
            DiagnosticClass::MissingDeclaration
        } else if MODULE_SYNTAX_CODES.binary_search(&code).is_ok() {
            DiagnosticClass::TypeScriptGrammar
        } else if EMITTED_OUTPUT_CODES.binary_search(&code).is_ok() {
            DiagnosticClass::EmittedOutput
        } else {
            DiagnosticClass::Semantic
        }
    }

    pub fn of_grammar_code(code: u32) -> DiagnosticClass {
        match DiagnosticClass::of_code(code) {
            DiagnosticClass::EmittedOutput => DiagnosticClass::EmittedOutput,
            _ => DiagnosticClass::TypeScriptGrammar,
        }
    }

    pub fn early_error_if(is_early_error: bool, otherwise: DiagnosticClass) -> DiagnosticClass {
        if is_early_error {
            DiagnosticClass::EarlyError
        } else {
            otherwise
        }
    }

    pub fn stricter(self, other: DiagnosticClass) -> DiagnosticClass {
        if (other as u8) < (self as u8) {
            other
        } else {
            self
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_early_error_and_zero() {
        assert_eq!(DiagnosticClass::default(), DiagnosticClass::EarlyError);
        assert_eq!(DiagnosticClass::default() as u8, 0);
    }

    #[test]
    fn stricter_is_commutative() {
        for a in DiagnosticClass::ALL {
            for b in DiagnosticClass::ALL {
                assert_eq!(a.stricter(b), b.stricter(a));
                assert_eq!(a.stricter(b) as u8, (a as u8).min(b as u8));
            }
        }
    }

    #[test]
    fn classes_are_listed_in_order() {
        for (index, class) in DiagnosticClass::ALL.into_iter().enumerate() {
            assert_eq!(class as usize, index);
        }
    }

    #[test]
    fn code_tables_are_sorted_and_disjoint() {
        let tables: [&[u32]; 4] = [
            &MISSING_DECLARATION_CODES,
            &MODULE_SYNTAX_CODES,
            &EMITTED_OUTPUT_CODES,
            &STYLE_CODES,
        ];
        let mut all: Vec<u32> = Vec::new();
        for table in tables {
            assert!(table.windows(2).all(|pair| pair[0] < pair[1]));
            all.extend_from_slice(table);
        }
        let count = all.len();
        all.sort_unstable();
        all.dedup();
        assert_eq!(all.len(), count);
    }

    #[test]
    fn class_follows_code() {
        assert_eq!(DiagnosticClass::of_code(2322), DiagnosticClass::Semantic);
        assert_eq!(DiagnosticClass::of_code(7006), DiagnosticClass::Style);
        assert_eq!(DiagnosticClass::of_code(6133), DiagnosticClass::Style);
        for code in [1313, 2774, 2869, 2872, 4112, 4113] {
            assert_eq!(
                DiagnosticClass::of_code(code),
                DiagnosticClass::Style,
                "{code}"
            );
        }
        for code in [2304, 2307, 2550, 2552, 2663, 2882, 7016, 18004] {
            assert_eq!(
                DiagnosticClass::of_code(code),
                DiagnosticClass::MissingDeclaration,
                "{code}"
            );
        }
        assert_eq!(
            DiagnosticClass::of_code(1484),
            DiagnosticClass::TypeScriptGrammar
        );
        for code in [1203, 1309, 1343, 1479, 1544, 2354, 2725, 2854, 6142, 17004] {
            assert_eq!(
                DiagnosticClass::of_code(code),
                DiagnosticClass::EmittedOutput,
                "{code}"
            );
        }
    }
}
