//! JavaScript files: which diagnostics apply to them.
//!
//! A port of `canIncludeBindAndCheckDiagnostics`, `getBindAndCheckDiagnosticsWithChecker` and `getAdditionalJSSyntacticDiagnostics`
//! (TypeScript 7.0.2, compiler/program.go). `checkJSSyntax` (parser/parser.go) is in the lowering: `hir::File::js_diagnostics`.

use super::*;

/// `plainJSErrors` (compiler/program.go): what is said of JavaScript nobody asked to have checked. In order.
pub(super) const PLAIN_JS_ERRORS: [u32; 91] = [
    1005, 1009, 1013, 1014, 1029, 1030, 1031, 1042, 1044, 1048, 1049, 1053, 1054, 1089, 1090, 1091,
    1097, 1100, 1101, 1102, 1104, 1105, 1106, 1107, 1111, 1113, 1114, 1115, 1116, 1123, 1155, 1156,
    1162, 1171, 1172, 1174, 1182, 1184, 1186, 1188, 1189, 1190, 1191, 1193, 1197, 1200, 1210, 1211,
    1214, 1215, 1248, 1255, 1258, 1262, 1308, 1312, 1325, 1341, 1344, 1358, 1359, 1368, 1450, 1451,
    1473, 1474, 2451, 2462, 2480, 2492, 2501, 2528, 2566, 2633, 2752, 2753, 2803, 2839, 2852, 5076,
    17000, 17001, 17012, 18006, 18007, 18012, 18013, 18016, 18036, 18038, 18041,
];

/// What TypeScript's parser and scanner say. In order.
pub(crate) const SYNTACTIC_ERRORS: [u32; 159] = [
    1002, 1003, 1005, 1007, 1010, 1011, 1012, 1034, 1068, 1084, 1109, 1110, 1121, 1124, 1125, 1126,
    1127, 1128, 1129, 1130, 1131, 1132, 1134, 1135, 1136, 1137, 1138, 1139, 1140, 1142, 1144, 1145,
    1146, 1160, 1161, 1177, 1178, 1179, 1180, 1181, 1185, 1198, 1199, 1206, 1209, 1228, 1260, 1327,
    1328, 1351, 1352, 1353, 1357, 1359, 1369, 1381, 1382, 1385, 1386, 1387, 1388, 1389, 1390, 1433,
    1434, 1435, 1436, 1437, 1438, 1439, 1440, 1441, 1442, 1443, 1453, 1472, 1477, 1478, 1486, 1487,
    1488, 1489, 1490, 1499, 1500, 1501, 1502, 1503, 1504, 1505, 1506, 1507, 1508, 1509, 1510, 1511,
    1512, 1513, 1514, 1515, 1516, 1517, 1518, 1519, 1520, 1521, 1522, 1523, 1524, 1525, 1526, 1527,
    1528, 1529, 1530, 1531, 1532, 1533, 1534, 1535, 1536, 1537, 1538, 2427, 2457, 2657, 2754, 2809,
    2819, 2880, 6188, 6189, 8002, 8003, 8004, 8005, 8006, 8008, 8009, 8010, 8011, 8012, 8013, 8016,
    8017, 8037, 8038, 17002, 17006, 17007, 17008, 17014, 17015, 17021, 18009, 18016, 18026, 18029,
    18030,
];

/// What TypeScript's checker only ever says through `grammarErrorOnNode` and its like: not of a file its parser objected to. In order.
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

    /// `IsPlainJSFile`: JavaScript of which nobody has said whether it is to be checked.
    pub(super) fn is_plain_js(&self, file: FileId) -> bool {
        let hir = self.hir(file);
        hir.is_js && hir.check_directive.is_none() && self.files().options.check_js.is_none()
    }

    /// `SkipTypeChecking`: whether anything but syntax is objected to.
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

    /// `transformSourceFile` of the declaration transformer: 6424, on each `module.exports = ..` of a module that has several.
    pub(super) fn check_module_exports_assignments(&mut self, file: FileId) {
        let files = self.files();
        if !self.hir(file).is_js || !files.options.emits_declarations {
            return;
        }
        let Some(equals) = files.export(files.file_symbol(file), known::export_equals) else {
            return;
        };
        let declarations = files.decls(equals);
        if declarations.len() < 2 {
            return;
        }
        for (of, declaration) in declarations {
            if of == file
                && let Some((start, end)) = self.error_range_of_declaration(file, declaration)
            {
                self.error_at((file, start, end), 6424, &[]);
            }
        }
    }
}

impl Checker<'_> {
    /// `checkGrammarSourceFile`: 1046. At the top of a declaration file, what declares a value says `declare` or `export`. Only the
    /// first that does not is objected to.
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

    /// `checkGrammarVariableDeclarationList`: 1123. `var ;` is a list of no declarations to the parser. It is said where the list would
    /// start: right after the keyword.
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

    /// `getAdditionalJSSyntacticDiagnostics`: the first decorator of each parameter, in a file the checker does not look at.
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
                // `decorator.Loc`, which starts where the token before it ends.
                let at = (file, hir[p].loc.pos, end_of_expr(hir, decorator));
                self.add_diagnostic(Reported::bare(at, 1206));
            }
        }
    }
}
