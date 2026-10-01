//! JavaScript files: which diagnostics apply to them, and the syntax that only TypeScript files may use: 1206 8002 8003 8004 8005 8006
//! 8008 8009 8010 8011 8012 8013 8016 8017 8037.
//!
//! A port of `canIncludeBindAndCheckDiagnostics`, `getBindAndCheckDiagnosticsWithChecker` and `getAdditionalJSSyntacticDiagnostics`
//! (TypeScript 7.0.2, compiler/program.go), and of `checkJSSyntax` (parser/parser.go).

use super::errors::Diagnostic;
use super::*;
use crate::bind::{FnOwner, MemberOwner};
use smallvec::SmallVec;

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
pub(super) const SYNTACTIC_ERRORS: [u32; 159] = [
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
            .unwrap_or(self.files().options.check_js == Some(true))
    }

    /// `IsPlainJSFile`: JavaScript of which nobody has said whether it is to be checked.
    pub(super) fn is_plain_js(&self, file: FileId) -> bool {
        let hir = self.hir(file);
        hir.is_js && hir.check_directive.is_none() && self.files().options.check_js.is_none()
    }

    /// `canIncludeBindAndCheckDiagnostics`: whether anything but syntax is objected to.
    pub(super) fn reports_semantic_errors(&self, file: FileId) -> bool {
        let hir = self.hir(file);
        hir.check_directive != Some(false)
            && (!hir.is_js || self.is_plain_js(file) || self.is_check_js(file))
    }

    /// `transformSourceFile` of the declaration transformer: 6424, on each `module.exports = ..` of a module that has several.
    pub(super) fn check_module_exports_assignments(&self, file: FileId, out: &mut Vec<Diagnostic>) {
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
                && let crate::bind::Decl::ModuleExports(assignment) = declaration
            {
                let start = self.start_of(file, assignment);
                out.push(Diagnostic { start, code: 6424 });
                self.note(start, self.end_of_expr(file, assignment), 6424, Vec::new());
            }
        }
    }
}

fn is_word_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'$' || b >= 0x80
}

/// Past blanks and comments.
fn skip_trivia(text: &[u8], mut i: usize) -> usize {
    loop {
        while text.get(i).is_some_and(u8::is_ascii_whitespace) {
            i += 1;
        }
        if text[i.min(text.len())..].starts_with(b"//") {
            i += text[i..]
                .iter()
                .position(|&c| c == b'\n')
                .unwrap_or(text.len() - i);
        } else if text[i.min(text.len())..].starts_with(b"/*") {
            i += text[i + 2..]
                .windows(2)
                .position(|w| w == b"*/")
                .map_or(text.len() - i, |n| n + 4);
        } else {
            return i;
        }
    }
}

/// Back over blanks and `/* */`: where what is written before `i` ends.
fn skip_trivia_back(text: &[u8], mut i: usize) -> usize {
    loop {
        while i > 0 && text[i - 1].is_ascii_whitespace() {
            i -= 1;
        }
        if i >= 2 && &text[i - 2..i] == b"*/" {
            match text[..i - 2].windows(2).rposition(|w| w == b"/*") {
                Some(open) => i = open,
                None => return i,
            }
        } else {
            return i;
        }
    }
}

fn word_at(text: &[u8], start: usize) -> &[u8] {
    let rest = &text[start.min(text.len())..];
    &rest[..rest
        .iter()
        .position(|&b| !is_word_byte(b))
        .unwrap_or(rest.len())]
}

fn word_before(text: &[u8], end: usize) -> &[u8] {
    let start = text[..end]
        .iter()
        .rposition(|&b| !is_word_byte(b))
        .map_or(0, |i| i + 1);
    &text[start..end]
}

/// The end of the string or template literal that starts at `start`.
fn quoted_end(text: &[u8], start: usize) -> Option<usize> {
    let quote = *text.get(start)?;
    let mut i = start + 1;
    loop {
        match *text.get(i)? {
            b'\\' => i += 2,
            b if b == quote => return Some(i + 1),
            _ => i += 1,
        }
    }
}

/// The end of the bracketed group that starts at `open`. Regular expression literals are not recognized.
fn bracketed_end(text: &[u8], open: usize) -> Option<usize> {
    let (mut depth, mut i) = (0u32, open);
    loop {
        match *text.get(i)? {
            b'[' | b'(' | b'{' => depth += 1,
            b']' | b')' | b'}' => {
                if depth <= 1 {
                    return Some(i + 1);
                }
                depth -= 1;
            }
            b'"' | b'\'' | b'`' => {
                i = quoted_end(text, i)?;
                continue;
            }
            b'/' if matches!(text.get(i + 1), Some(b'/' | b'*')) => {
                i = skip_trivia(text, i);
                continue;
            }
            _ => {}
        }
        i += 1;
    }
}

/// The end of the property name or binding pattern that starts at `start`.
fn name_end(text: &[u8], start: usize) -> Option<usize> {
    match *text.get(start)? {
        b'"' | b'\'' => quoted_end(text, start),
        b'[' | b'{' => bracketed_end(text, start),
        b'#' => Some(start + 1 + word_at(text, start + 1).len()),
        _ => Some(start + word_at(text, start).len()),
    }
}

/// The modifier a word is, if it is one that only TypeScript has.
fn typescript_modifier(word: &[u8]) -> Option<Flags> {
    Some(match word {
        b"public" => Flags::PUBLIC,
        b"private" => Flags::PRIVATE,
        b"protected" => Flags::PROTECTED,
        b"readonly" => Flags::READONLY,
        b"abstract" => Flags::ABSTRACT,
        b"declare" => Flags::AMBIENT,
        b"override" => Flags::OVERRIDE,
        b"const" => Flags::CONST,
        _ => return None,
    })
}

/// The words before `at` that go with what is declared there, the first one first: where each is, and whether only TypeScript has
/// it. `at` is the name of a member, or the keyword of a declaration, or anywhere among its modifiers.
fn modifiers_around(text: &[u8], at: u32, flags: Flags) -> SmallVec<[(u32, bool); 4]> {
    let is_modifier = |word: &[u8]| match typescript_modifier(word) {
        Some(flag) => flags.contains(flag).then_some(true),
        None => matches!(
            word,
            b"export" | b"default" | b"static" | b"async" | b"accessor" | b"get" | b"set"
        )
        .then_some(false),
    };
    let mut found: SmallVec<[(u32, bool); 4]> = SmallVec::new();
    let mut i = at as usize;
    loop {
        let mut end = skip_trivia_back(text, i);
        if end > 0 && text[end - 1] == b'*' {
            end = skip_trivia_back(text, end - 1);
        }
        let word = word_before(text, end);
        let Some(only_typescript) = is_modifier(word) else {
            break;
        };
        // `tryParseModifier`: no flag is kept for `const`, which is a name unless what it modifies is on its line.
        if word == b"const" && text[end..i].contains(&b'\n') {
            break;
        }
        i = end - word.len();
        found.push((i as u32, only_typescript));
    }
    found.reverse();
    let mut i = at as usize;
    loop {
        let word = word_at(text, i);
        let Some(only_typescript) = is_modifier(word) else {
            break;
        };
        let next = skip_trivia(text, i + word.len());
        // A member can be called by any of these words.
        if !text.get(next).is_some_and(|&b| {
            is_word_byte(b) || matches!(b, b'[' | b'"' | b'\'' | b'#' | b'*' | b'{')
        }) {
            break;
        }
        if word == b"const" && text[i + word.len()..next].contains(&b'\n') {
            break;
        }
        found.push((i as u32, only_typescript));
        i = next;
    }
    found
}

/// Where the class member `member` starts: at its first modifier, or at its name.
pub(super) fn start_of_member(text: &[u8], member: &Member) -> u32 {
    if member.pos as usize > text.len() {
        return member.pos;
    }
    modifiers_around(text, member.pos, member.flags | Flags::CONST)
        .first()
        .map_or(member.pos, |m| m.0)
}

/// `IsModifier`, of the word before the name of a parameter (`name`) or before its `...`. `start`: where the parameter starts.
fn has_parameter_modifier(text: &[u8], start: u32, name: u32) -> bool {
    let mut end = skip_trivia_back(text, (name as usize).min(text.len()));
    if text[..end].ends_with(b"...") {
        end = skip_trivia_back(text, end - 3);
    }
    let word = word_before(text, end);
    let word_start = end - word.len();
    word_start >= start as usize
        && matches!(
            word,
            b"public"
                | b"private"
                | b"protected"
                | b"readonly"
                | b"override"
                | b"static"
                | b"declare"
                | b"async"
                | b"abstract"
                | b"accessor"
                | b"export"
        )
        // The end of a decorator: `@a.static`.
        && !matches!(text[..word_start].last(), Some(b'.' | b'@'))
}

/// Where the modifiers of a parameter end: before its name (`name`) or before its `...`.
fn end_of_parameter_modifiers(text: &[u8], name: u32) -> u32 {
    let mut end = skip_trivia_back(text, (name as usize).min(text.len()));
    if text[..end].ends_with(b"...") {
        end = skip_trivia_back(text, end - 3);
    }
    end as u32
}

/// `namespace` or `module`: the keyword of the declaration one of whose names is at `name`, as in `namespace a.b`.
fn module_keyword(text: &[u8], name: u32) -> &[u8] {
    let mut end = skip_trivia_back(text, (name as usize).min(text.len()));
    while end > 0 && text[end - 1] == b'.' {
        let outer_end = skip_trivia_back(text, end - 1);
        let outer = word_before(text, outer_end);
        end = skip_trivia_back(text, outer_end - outer.len());
    }
    word_before(text, end)
}

fn text_of(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

impl Checker<'_> {
    /// `checkGrammarSourceFile`: 1046. At the top of a declaration file, what declares a value says `declare` or `export`. Only the
    /// first that does not is objected to.
    pub(super) fn check_declare_modifiers(&self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        if hir.kind != FileKind::Declaration || hir.text.is_empty() {
            return;
        }
        for s in hir.ids(hir.body) {
            if !matches!(
                hir[s].kind,
                StmtKind::Fn(_)
                    | StmtKind::Class(_)
                    | StmtKind::Enum(_)
                    | StmtKind::Module(_)
                    | StmtKind::Var(_)
            ) {
                continue;
            }
            // Everything in such a file counts as declared: whether it says so is a matter of how it is written.
            let modifiers =
                modifiers_around(&hir.text, hir[s].pos, Flags::AMBIENT | Flags::ABSTRACT);
            let start = modifiers.first().map_or(hir[s].pos, |m| m.0);
            if !modifiers
                .iter()
                .any(|m| matches!(word_at(&hir.text, m.0 as usize), b"declare" | b"export"))
            {
                out.push(Diagnostic { start, code: 1046 });
                return;
            }
        }
    }

    /// `checkGrammarVariableDeclarationList`: 1123. `var ;` is a list of no declarations to the parser. It is said where the list would
    /// start: right after the keyword.
    pub(super) fn check_empty_declaration_lists(&self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        if hir.text.is_empty() {
            return;
        }
        for stmt in &hir.stmts {
            if !matches!(stmt.kind, StmtKind::Var(decls) if decls.is_empty()) {
                continue;
            }
            let mut at = stmt.pos as usize;
            loop {
                let word = word_at(&hir.text, at);
                let end = at + word.len();
                match word {
                    b"var" | b"let" | b"const" | b"using" => {
                        out.push(Diagnostic {
                            start: end as u32,
                            code: 1123,
                        });
                        // The list is empty, and so is the error.
                        self.note(end as u32, super::explain::NO_LENGTH, 1123, Vec::new());
                        break;
                    }
                    b"export" | b"declare" | b"await" => at = skip_trivia(&hir.text, end),
                    _ => break,
                }
            }
        }
    }

    /// `checkJSSyntax`, `checkJSDecoratorSyntax` and `getAdditionalJSSyntacticDiagnostics`. tsgo's parser calls `checkJSSyntax` when it
    /// finishes a declaration, a class element, a parameter or an expression, but not for a node that is part of a type: the members
    /// of an interface get no diagnostics of their own.
    pub(super) fn check_js_syntax(&self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !hir.is_js || hir.text.is_empty() {
            return;
        }
        let text = &hir.text[..];
        // What is made from a tag of a comment is not written in the file.
        let mut say = |start: u32, code: u32| {
            if !hir.is_in_jsdoc(start) {
                out.push(Diagnostic { start, code });
            }
        };
        let ends = |start: u32, end: u32, code: u32| self.note(start, end, code, Vec::new());
        let is_modifier =
            |at: u32| self.note(at, 0, 8009, vec![text_of(word_at(text, at as usize))]);
        let is_question_token = |at: u32| self.note(at, 0, 8009, vec!["?".to_owned()]);
        let declares =
            |start: u32, end: u32, what: &str| self.note(start, end, 8006, vec![what.to_owned()]);
        // The start of the `?` token that follows the property name or binding pattern at `start`.
        let question_token = |start: u32| {
            let at = skip_trivia(text, name_end(text, start as usize)?);
            (text.get(at) == Some(&b'?')).then_some(at as u32)
        };
        // The same for the property name `key` at `start`. `None` for a computed name whose `[` was not located.
        let question_token_after_key = |key: PropKey, start: u32| {
            let is_located =
                !matches!(key, PropKey::Computed(_)) || text.get(start as usize) == Some(&b'[');
            if is_located {
                question_token(start)
            } else {
                None
            }
        };

        // `ParseFlagsType`: the signatures that are types, or members of types.
        let is_part_of_a_type = |func: FnId| match (hir[func].kind, bound.fns[func.idx()].owner) {
            (FnKind::Decl | FnKind::Expr | FnKind::Arrow | FnKind::StaticBlock, _) => false,
            (
                FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor,
                FnOwner::Member(m),
            ) => !matches!(bound.member_owner[m.idx()], MemberOwner::Class(_)),
            (FnKind::Method | FnKind::Getter | FnKind::Setter, _) => false,
            _ => true,
        };
        for (index, param) in hir.params.iter().enumerate() {
            if is_part_of_a_type(bound.param_fn[index]) {
                continue;
            }
            if param.flags.contains(Flags::OPTIONAL)
                && let Some(at) = question_token(hir[param.pat].pos)
            {
                say(at, 8009);
                is_question_token(at);
            }
            if param.ty.is_some() {
                say(hir[param.ty].pos, 8010);
                ends(
                    hir[param.ty].pos,
                    self.end_of_type_node(file, param.ty),
                    8010,
                );
            }
            if param.flags.intersects(
                Flags::PUBLIC
                    | Flags::PRIVATE
                    | Flags::PROTECTED
                    | Flags::READONLY
                    | Flags::OVERRIDE,
            ) || param.pat.is_some()
                && has_parameter_modifier(text, param.pos, hir[param.pat].pos)
            {
                say(param.pos, 8012);
                if param.pat.is_some() {
                    ends(
                        param.pos,
                        end_of_parameter_modifiers(text, hir[param.pat].pos),
                        8012,
                    );
                }
            }
        }
        for decl in &hir.var_decls {
            if decl.ty.is_some() {
                say(hir[decl.ty].pos, 8010);
                ends(hir[decl.ty].pos, self.end_of_type_node(file, decl.ty), 8010);
            }
        }
        for (index, func) in hir.fns.iter().enumerate() {
            // Where it starts, and the modifiers that count as its own.
            let (at, flags) = match (func.kind, bound.fns[index].owner) {
                // `parseClassElement`: the one signature that is asked about.
                (FnKind::IndexSignature, FnOwner::Member(m))
                    if matches!(bound.member_owner[m.idx()], MemberOwner::Class(_)) =>
                {
                    let start = modifiers_around(text, hir[m].pos, hir[m].flags)
                        .first()
                        .map_or(hir[m].pos, |m| m.0);
                    say(start, 8017);
                    ends(start, self.end_of_member(file, m), 8017);
                    continue;
                }
                _ if is_part_of_a_type(FnId(index as u32)) || func.kind == FnKind::StaticBlock => {
                    continue;
                }
                (FnKind::Decl, FnOwner::Stmt(s)) => (hir[s].pos, func.flags),
                (_, FnOwner::Member(m)) => (hir[m].pos, hir[m].flags | Flags::CONST),
                _ => (func.pos, Flags::empty()),
            };
            let modifiers = modifiers_around(text, at, flags);
            let start = modifiers.first().map_or(at, |m| m.0);
            if matches!(func.body, FnBody::None) {
                say(start, 8017);
                ends(start, self.end_of_fn(file, FnId(index as u32)), 8017);
            } else if func.ret.is_some() {
                say(hir[func.ret].pos, 8010);
                ends(
                    hir[func.ret].pos,
                    self.end_of_type_node(file, func.ret),
                    8010,
                );
            }
            if let Some(last) = func.type_params.iter().next_back() {
                say(hir[func.type_params.at(0)].pos, 8004);
                ends(
                    hir[func.type_params.at(0)].pos,
                    self.end_of_type_param(file, last),
                    8004,
                );
            }
            for &(at, only_typescript) in &modifiers {
                if only_typescript {
                    say(at, 8009);
                    is_modifier(at);
                }
            }
        }
        for (index, member) in hir.members.iter().enumerate() {
            if !matches!(bound.member_owner[index], MemberOwner::Class(_)) {
                continue;
            }
            if matches!(member.kind, MemberKind::Property | MemberKind::Method)
                && member.flags.contains(Flags::OPTIONAL)
                && let Some(at) = question_token_after_key(member.key, member.pos)
            {
                say(at, 8009);
                is_question_token(at);
            }
            if member.kind == MemberKind::Property {
                if member.ty.is_some() {
                    say(hir[member.ty].pos, 8010);
                    ends(
                        hir[member.ty].pos,
                        self.end_of_type_node(file, member.ty),
                        8010,
                    );
                }
                for (at, only_typescript) in
                    modifiers_around(text, member.pos, member.flags | Flags::CONST)
                {
                    if only_typescript {
                        say(at, 8009);
                        is_modifier(at);
                    }
                }
            }
        }
        // `parseObjectLiteralElement` passes the `?` after the name on to `parseMethodDeclaration`.
        for prop in &hir.props {
            if prop.kind == PropKind::Method
                && let Some(at) = question_token_after_key(prop.key, prop.pos)
            {
                say(at, 8009);
                is_question_token(at);
            }
        }
        // `hir.decorators` keeps the decorators of one owner together, in source order. Only the first one is reported.
        let reports_parameter_decorators = !self.is_check_js(file) && !hir.legacy_decorators;
        // Where the decorator whose `@` is at `at_sign` ends. The parentheses of `@(x)` are only in the text.
        let decorator_end = |at_sign: usize, expression: ExprId| {
            let end = self.end_of_expr(file, expression);
            let open = skip_trivia(text, at_sign + 1);
            if text.get(open) == Some(&b'(') {
                end.max(self.end_of_bracket_at(file, open as u32))
            } else {
                end
            }
        };
        let mut previous_owner = None;
        for &(owner, decorator) in &hir.decorators {
            if previous_owner.replace(owner) == Some(owner) {
                continue;
            }
            match owner {
                // `checkJSDecoratorSyntax`: `CanHaveIllegalDecorators` holds for a constructor.
                DecoratorOwner::Member(m) if hir[m].kind == MemberKind::Constructor => {
                    let expression_start =
                        (self.start_of(file, decorator) as usize).min(text.len());
                    if let Some(at_sign) = text[..expression_start].iter().rposition(|&b| b == b'@')
                    {
                        say(at_sign as u32, 1206);
                        ends(at_sign as u32, decorator_end(at_sign, decorator), 1206);
                    }
                }
                // `getAdditionalJSSyntacticDiagnostics` reports `decorator.Loc`, which starts where the previous token ends.
                DecoratorOwner::Param(p) if reports_parameter_decorators => {
                    let start = skip_trivia_back(text, hir[p].pos as usize) as u32;
                    say(start, 1206);
                    ends(start, decorator_end(hir[p].pos as usize, decorator), 1206);
                }
                _ => {}
            }
        }
        for class in &hir.classes {
            if let Some(last) = class.type_params.iter().next_back() {
                say(hir[class.type_params.at(0)].pos, 8004);
                ends(
                    hir[class.type_params.at(0)].pos,
                    self.end_of_type_param(file, last),
                    8004,
                );
            }
            for (at, only_typescript) in modifiers_around(text, class.pos, class.flags) {
                if only_typescript {
                    say(at, 8009);
                    is_modifier(at);
                }
            }
            if !class.implements.is_empty() {
                let first = hir[hir.id_at(class.implements, 0)].pos as usize;
                let end = skip_trivia_back(text, first);
                if word_before(text, end) == b"implements" {
                    let start = (end - b"implements".len()) as u32;
                    say(start, 8005);
                    ends(start, self.end_of_type_args(file, class.implements), 8005);
                }
            }
            if !class.extends_args.is_empty() {
                say(hir[hir.id_at(class.extends_args, 0)].pos, 8011);
                ends(
                    hir[hir.id_at(class.extends_args, 0)].pos,
                    self.end_of_type_args(file, class.extends_args),
                    8011,
                );
            }
        }
        for (index, stmt) in hir.stmts.iter().enumerate() {
            let s = StmtId(index as u32);
            match stmt.kind {
                StmtKind::Var(decls) if !decls.is_empty() => {
                    for (at, only_typescript) in
                        modifiers_around(text, stmt.pos, hir[decls.at(0)].flags)
                    {
                        if only_typescript {
                            say(at, 8009);
                            is_modifier(at);
                        }
                    }
                }
                StmtKind::Import(i) if hir[i].type_only => {
                    say(stmt.pos, 8006);
                    declares(stmt.pos, self.end_of_stmt(file, s), "import type");
                }
                StmtKind::ExportNamed(e) if hir[e].type_only => {
                    say(stmt.pos, 8006);
                    declares(stmt.pos, self.end_of_stmt(file, s), "export type");
                }
                StmtKind::ExportStar { .. }
                    if word_at(text, stmt.pos as usize) == b"export"
                        && word_at(
                            text,
                            skip_trivia(text, stmt.pos as usize + b"export".len()),
                        ) == b"type" =>
                {
                    say(stmt.pos, 8006);
                    declares(stmt.pos, self.end_of_stmt(file, s), "export type");
                }
                StmtKind::ImportEquals(i) => {
                    let start = modifiers_around(text, stmt.pos, hir[i].flags)
                        .first()
                        .map_or(stmt.pos, |m| m.0);
                    say(start, 8002);
                    ends(start, self.end_of_stmt(file, s), 8002);
                }
                StmtKind::ExportAssign(_) => {
                    say(stmt.pos, 8003);
                    ends(stmt.pos, self.end_of_stmt(file, s), 8003);
                }
                StmtKind::Interface(i) => {
                    say(hir[i].name_pos, 8006);
                    declares(hir[i].name_pos, 0, "interface");
                }
                // `parseAmbientExternalModuleDeclaration` (`module "m"`, `global`) does not call `checkJSSyntax`.
                StmtKind::Module(m) if matches!(hir[m].name, ModuleName::Ident(_)) => {
                    say(hir[m].name_pos, 8006);
                    let keyword = text_of(module_keyword(text, hir[m].name_pos));
                    declares(hir[m].name_pos, 0, &keyword);
                }
                StmtKind::Enum(e) => {
                    say(hir[e].name_pos, 8006);
                    declares(hir[e].name_pos, 0, "enum");
                }
                StmtKind::TypeAlias(a) => say(hir[a].name_pos, 8008),
                _ => {}
            }
        }
        // `{ type a }`: it starts with the `type`.
        let with_type = |name: u32| {
            let end = skip_trivia_back(text, name as usize);
            if word_before(text, end) == b"type" {
                (end - b"type".len()) as u32
            } else {
                name
            }
        };
        for (index, spec) in hir.import_specs.iter().enumerate() {
            if spec.type_only {
                let start = with_type(spec.pos.min(spec.imported_pos));
                say(start, 8006);
                let end = self.end_of_import_spec(file, ImportSpecId(index as u32));
                declares(start, end, "import...type");
            }
        }
        for (index, spec) in hir.export_specs.iter().enumerate() {
            if spec.type_only {
                let start = with_type(spec.pos.min(spec.local_pos));
                say(start, 8006);
                let end = self.end_of_export_spec(file, ExportSpecId(index as u32));
                declares(start, end, "export...type");
            }
        }
        for (index, e) in hir.exprs.iter().enumerate() {
            match e.kind {
                ExprKind::NonNull(_) => {
                    let start = self.start_of(file, ExprId(index as u32));
                    say(start, 8013);
                    ends(start, self.end_of_expr(file, ExprId(index as u32)), 8013);
                }
                ExprKind::As { ty, .. } => {
                    say(hir[ty].pos, 8016);
                    ends(hir[ty].pos, self.end_of_type_node(file, ty), 8016);
                }
                ExprKind::Satisfies { ty, .. } => {
                    say(hir[ty].pos, 8037);
                    ends(hir[ty].pos, self.end_of_type_node(file, ty), 8037);
                }
                _ => {}
            }
        }
        for call in &hir.calls {
            if !call.type_args.is_empty() {
                say(hir[hir.id_at(call.type_args, 0)].pos, 8011);
                ends(
                    hir[hir.id_at(call.type_args, 0)].pos,
                    self.end_of_type_args(file, call.type_args),
                    8011,
                );
            }
        }
    }
}
