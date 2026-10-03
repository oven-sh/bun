//! JavaScript files: which diagnostics apply to them.
//!
//! A port of `canIncludeBindAndCheckDiagnostics`, `getBindAndCheckDiagnosticsWithChecker` and `getAdditionalJSSyntacticDiagnostics`
//! (TypeScript 7.0.2, compiler/program.go). `checkJSSyntax` (parser/parser.go) runs during lowering: `hir::DiagnosticKind::Js`.

use super::*;

/// `plainJSErrors` (compiler/program.go): the codes reported for JavaScript that is not opted into
/// checking. In order.
pub(super) const PLAIN_JS_ERRORS: [u32; 91] = [
    1005, 1009, 1013, 1014, 1029, 1030, 1031, 1042, 1044, 1048, 1049, 1053, 1054, 1089, 1090, 1091,
    1097, 1100, 1101, 1102, 1104, 1105, 1106, 1107, 1111, 1113, 1114, 1115, 1116, 1123, 1155, 1156,
    1162, 1171, 1172, 1174, 1182, 1184, 1186, 1188, 1189, 1190, 1191, 1193, 1197, 1200, 1210, 1211,
    1214, 1215, 1248, 1255, 1258, 1262, 1308, 1312, 1325, 1341, 1344, 1358, 1359, 1368, 1450, 1451,
    1473, 1474, 2451, 2462, 2480, 2492, 2501, 2528, 2566, 2633, 2752, 2753, 2803, 2839, 2852, 5076,
    17000, 17001, 17012, 18006, 18007, 18012, 18013, 18016, 18036, 18038, 18041,
];

/// The codes TypeScript's checker only reports through `grammarErrorOnNode` and similar functions,
/// so never in a file with parse errors. In order.
pub(super) const GRAMMAR_ERRORS: [u32; 164] = [
    1014, 1015, 1016, 1017, 1018, 1019, 1020, 1021, 1022, 1024, 1028, 1029, 1030, 1031, 1035, 1036,
    1038, 1039, 1040, 1042, 1044, 1046, 1047, 1048, 1049, 1051, 1052, 1053, 1054, 1070, 1071, 1079,
    1089, 1090, 1092, 1093, 1094, 1095, 1096, 1097, 1098, 1099, 1106, 1107, 1108, 1111, 1113, 1114,
    1117, 1118, 1119, 1120, 1123, 1155, 1163, 1171, 1172, 1173, 1174, 1175, 1176, 1182, 1183, 1187,
    1191, 1193, 1196, 1197, 1200, 1202, 1203, 1207, 1211, 1216, 1218, 1221, 1222, 1242, 1243, 1246,
    1247, 1248, 1249, 1254, 1257, 1265, 1266, 1268, 1273, 1274, 1275, 1277, 1300, 1312, 1317, 1318,
    1323, 1324, 1325, 1326, 1330, 1331, 1332, 1333, 1334, 1335, 1337, 1338, 1354, 1358, 1363, 1392,
    1450, 1451, 1454, 1463, 1464, 1491, 1492, 1493, 1494, 1495, 1545, 1546, 1547, 1548, 2410, 2480,
    2492, 2501, 2566, 2633, 2639, 2666, 2667, 2714, 2737, 2803, 2823, 2856, 2857, 5076, 5085, 5086,
    5087, 7060, 7061, 8020, 8023, 17000, 17001, 17012, 18006, 18007, 18010, 18019, 18036, 18038,
    18041, 18057, 18058, 18059, 18060, 18061,
];

impl Checker<'_> {
    /// `IsCheckJSEnabledForFile`
    pub(super) fn is_check_js(&self, file: FileId) -> bool {
        self.hir(file)
            .check_directive
            .unwrap_or_else(|| self.files().options.check_js == Some(true))
    }

    /// `IsPlainJSFile`: JavaScript for which checking is neither enabled nor disabled.
    pub(super) fn is_plain_js(&self, file: FileId) -> bool {
        let hir = self.hir(file);
        hir.is_js && hir.check_directive.is_none() && self.files().options.check_js.is_none()
    }

    /// `SkipTypeChecking`: whether anything other than syntax errors is reported.
    pub(super) fn reports_semantic_errors(&self, file: FileId) -> bool {
        let options = &self.files().options;
        let hir = self.hir(file);
        if options.no_check
            || options.skip_lib_check && hir.kind == FileKind::Declaration
            || options.skip_default_lib_check && self.files().module(file).is_lib
        {
            return false;
        }
        hir.check_directive != Some(false)
            && (!hir.is_js || self.is_plain_js(file) || self.is_check_js(file))
    }
}

impl Checker<'_> {
    /// `checkGrammarSourceFile`: 1046. At the top level of a declaration file, a value declaration
    /// must have `declare` or `export`. Only the first that does not is reported.
    pub(super) fn check_declare_modifiers(&mut self, file: FileId) {
        let hir = self.hir(file);
        if hir.kind != FileKind::Declaration {
            return;
        }
        for s in hir.ids(hir.body) {
            let is_declared = |modifier: &Modifier| {
                matches!(modifier.kind, ModifierKind::Keyword(flag)
                    if flag.intersects(Flags::AMBIENT | Flags::EXPORT | Flags::DEFAULT))
            };
            if matches!(
                hir[s].kind,
                StmtKind::Fn(_)
                    | StmtKind::Class(_)
                    | StmtKind::Enum(_)
                    | StmtKind::Module(_)
                    | StmtKind::Var(_)
            ) && !hir.modifier_list(hir[s].modifiers).iter().any(is_declared)
            {
                let start = hir[s].start;
                self.error_at((file, start, 0), 1046, &[]);
                return;
            }
        }
    }

    /// `checkGrammarVariableDeclarationList`: 1123. `var ;` parses as an empty declaration list. It
    /// is reported where the list would start: right after the keyword.
    pub(super) fn check_empty_declaration_lists(&mut self, file: FileId) {
        let hir = self.hir(file);
        if hir.text.is_empty() {
            return;
        }
        for (s, stmt) in hir.stmts.iter().enumerate() {
            if !matches!(stmt.kind, StmtKind::Var(decls) if decls.is_empty()) {
                continue;
            }
            let mut at = self.start_after_modifiers(file, StmtId(s as u32)) as usize;
            loop {
                let word = word_at(&hir.text, at);
                let end = at + word.len();
                match word {
                    b"var" | b"let" | b"const" | b"using" => {
                        self.error_at((file, end as u32, end as u32), 1123, &[]);
                        break;
                    }
                    b"await" => at = skip_trivia(&hir.text, end),
                    _ => break,
                }
            }
        }
    }

    /// `getAdditionalJSSyntacticDiagnostics`: the first decorator of each parameter, in a file the
    /// checker does not check.
    pub(super) fn get_additional_js_syntactic_diagnostics(&mut self, file: FileId) {
        let hir = self.hir(file);
        if !hir.is_js || hir.legacy_decorators || self.is_check_js(file) {
            return;
        }
        let mut previous_owner = None;
        for &(owner, decorator) in &hir.decorators {
            if previous_owner.replace(owner) != Some(owner)
                && let DecoratorOwner::Param(p) = owner
            {
                // `decorator.Loc`, which starts at the end of the previous token.
                let at = (file, hir[p].loc.pos, end_of_expr(hir, decorator));
                self.add_diagnostic(Reported::bare(at, 1206));
            }
        }
    }
}
