//! JavaScript files: which diagnostics apply to them, and the syntax that only TypeScript files may use: 1206 8002 8003 8004 8005 8006
//! 8008 8009 8010 8011 8012 8013 8016 8017 8037.
//!
//! A port of `canIncludeBindAndCheckDiagnostics`, `getBindAndCheckDiagnosticsWithChecker` and `getAdditionalJSSyntacticDiagnostics`
//! (TypeScript 7.0.2, compiler/program.go), and of `checkJSSyntax` (parser/parser.go).

use super::sink::held;
use super::*;
use crate::bind::{FnOwner, MemberOwner};

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
                && let crate::bind::Decl::ModuleExports(assignment) = declaration
            {
                let start = self.start_of(file, assignment);
                self.error_at((file, start, self.end_of_expr(file, assignment)), 6424, &[]);
            }
        }
    }
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

/// The end of the property name or binding pattern that starts at `start`.
fn name_end(text: &[u8], start: usize) -> Option<usize> {
    match *text.get(start)? {
        b'"' | b'\'' => quoted_end(text, start),
        b'[' | b'{' => end_of_brackets(text, start),
        b'#' => Some(start + 1 + word_at(text, start + 1).len()),
        _ => Some(start + word_at(text, start).len()),
    }
}

/// The modifiers of `list` that are written and are not of `ModifierFlagsJavaScript`: where each is, and `TokenToString` of it.
fn typescript_modifiers(
    hir: &hir::File,
    list: Span<ModifierId>,
) -> impl Iterator<Item = (u32, &'static str)> {
    // What a tag of a comment makes is `REPARSED` besides.
    const JAVASCRIPT: Flags = Flags::EXPORT
        .union(Flags::STATIC)
        .union(Flags::ACCESSOR)
        .union(Flags::ASYNC)
        .union(Flags::DEFAULT)
        .union(Flags::REPARSED);
    let list = hir.modifier_list(list).iter();
    list.filter_map(|modifier| match modifier.kind {
        ModifierKind::Keyword(flag) if !JAVASCRIPT.intersects(flag) => Some((
            modifier.pos,
            super::errors_grammar_modifiers::modifier_text(flag),
        )),
        _ => None,
    })
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

    /// `checkJSSyntax`, `checkJSDecoratorSyntax` and `getAdditionalJSSyntacticDiagnostics`. tsgo's parser calls `checkJSSyntax` when it
    /// finishes a declaration, a class element, a parameter or an expression, but not for a node that is part of a type: the members
    /// of an interface get no diagnostics of their own.
    pub(super) fn check_js_syntax(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !hir.is_js || hir.text.is_empty() {
            return;
        }
        let text = &hir.text[..];
        // `jsErrorAtRange`. What is made from a tag of a comment is not written in the file. An end of 0: that of the token at the start.
        let error = |c: &mut Self, (start, end): (u32, u32), code: u32, argument: &str| {
            if !hir.is_in_jsdoc(start) {
                let argument = (!argument.is_empty()).then(|| argument.to_owned());
                c.add_diagnostic(Reported::new(
                    (file, start, end),
                    code,
                    held(argument.into_iter().collect()),
                ));
            }
        };
        let type_loc = |c: &Self, ty: TypeNodeId| (hir[ty].pos, c.end_of_type_node(file, ty));
        let type_argument_list_loc = |c: &Self, list: IdList<TypeNodeId>| {
            let first = hir[hir.id_at(list, 0)].pos;
            (first, c.end_of_type_args(file, list))
        };
        let type_parameter_list_loc = |c: &Self, list: Span<TypeParamId>| {
            let last = list.iter().next_back()?;
            Some((hir[list.at(0)].pos, c.end_of_type_param(file, last)))
        };
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
                error(self, (at, 0), 8009, "?");
            }
            if param.ty.is_some() {
                error(self, type_loc(self, param.ty), 8010, "");
            }
            // `node.Modifiers().Loc`
            let modifiers = hir.modifier_list(hir.param_modifiers(ParamId(index as u32)));
            let is_modifier = |it: &Modifier| matches!(it.kind, ModifierKind::Keyword(_));
            if let Some(last) = modifiers.last()
                && modifiers.iter().any(is_modifier)
            {
                let end = match last.kind {
                    ModifierKind::Keyword(flag) => {
                        last.pos + super::errors_grammar_modifiers::modifier_text(flag).len() as u32
                    }
                    ModifierKind::Decorator(it) => self.end_of_expr(file, it),
                };
                error(self, (param.pos, end), 8012, "");
            }
        }
        for decl in hir.var_decls.iter().filter(|decl| decl.ty.is_some()) {
            error(self, type_loc(self, decl.ty), 8010, "");
        }
        for (index, func) in hir.fns.iter().enumerate() {
            let id = FnId(index as u32);
            // `node.ModifierNodes()`
            let modifiers = match (func.kind, bound.fns[index].owner) {
                // `parseClassElement`: the one signature that is asked about.
                (FnKind::IndexSignature, FnOwner::Member(m))
                    if matches!(bound.member_owner[m.idx()], MemberOwner::Class(_)) =>
                {
                    error(self, (hir[m].start, hir[m].loc.end), 8017, "");
                    continue;
                }
                _ if is_part_of_a_type(id) || func.kind == FnKind::StaticBlock => continue,
                (FnKind::Decl, FnOwner::Stmt(s)) => hir[s].modifiers,
                (_, FnOwner::Member(m)) => hir[m].modifiers,
                _ => Span::default(),
            };
            if matches!(func.body, FnBody::None) {
                error(self, (func.start, self.end_of_fn(file, id)), 8017, "");
            } else if func.ret.is_some() {
                error(self, type_loc(self, func.ret), 8010, "");
            }
            if let Some(loc) = type_parameter_list_loc(self, func.type_params) {
                error(self, loc, 8004, "");
            }
            for (at, token) in typescript_modifiers(hir, modifiers) {
                error(self, (at, 0), 8009, token);
            }
        }
        for (index, member) in hir.members.iter().enumerate() {
            if !matches!(bound.member_owner[index], MemberOwner::Class(_)) {
                continue;
            }
            if matches!(member.kind, MemberKind::Property | MemberKind::Method)
                && member.flags.contains(Flags::OPTIONAL)
                && let Some(at) = question_token_after_key(member.key, member.name_pos)
            {
                error(self, (at, 0), 8009, "?");
            }
            if member.kind == MemberKind::Property {
                if member.ty.is_some() {
                    error(self, type_loc(self, member.ty), 8010, "");
                }
                for (at, token) in typescript_modifiers(hir, member.modifiers) {
                    error(self, (at, 0), 8009, token);
                }
            }
        }
        // `parseObjectLiteralElement` passes the `?` after the name on to `parseMethodDeclaration`.
        for prop in &hir.props {
            if prop.kind == PropKind::Method
                && let Some(at) = question_token_after_key(prop.key, prop.pos)
            {
                error(self, (at, 0), 8009, "?");
            }
        }
        // `hir.decorators` keeps the decorators of one owner together, in source order. Only the first one is reported.
        let reports_parameter_decorators = !self.is_check_js(file) && !hir.legacy_decorators;
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
                        error(
                            self,
                            (at_sign as u32, self.end_of_expr(file, decorator)),
                            1206,
                            "",
                        );
                    }
                }
                // `getAdditionalJSSyntacticDiagnostics` reports `decorator.Loc`, which starts where the previous token ends.
                DecoratorOwner::Param(p) if reports_parameter_decorators => {
                    let start = skip_trivia_back(text, hir[p].pos as usize) as u32;
                    error(self, (start, self.end_of_expr(file, decorator)), 1206, "");
                }
                _ => {}
            }
        }
        for class in &hir.classes {
            if let Some(loc) = type_parameter_list_loc(self, class.type_params) {
                error(self, loc, 8004, "");
            }
            for (at, token) in typescript_modifiers(hir, class.modifiers) {
                error(self, (at, 0), 8009, token);
            }
            if !class.implements.is_empty() {
                let first = hir[hir.id_at(class.implements, 0)].pos as usize;
                let end = skip_trivia_back(text, first);
                if word_before(text, end) == b"implements" {
                    let start = (end - b"implements".len()) as u32;
                    error(
                        self,
                        (start, self.end_of_type_args(file, class.implements)),
                        8005,
                        "",
                    );
                }
            }
            if !class.extends_args.is_empty() {
                error(
                    self,
                    type_argument_list_loc(self, class.extends_args),
                    8011,
                    "",
                );
            }
        }
        for (index, stmt) in hir.stmts.iter().enumerate() {
            let to_its_end =
                |c: &Self, start: u32| (start, c.end_of_stmt(file, StmtId(index as u32)));
            match stmt.kind {
                StmtKind::Var(_) => {
                    for (at, token) in typescript_modifiers(hir, stmt.modifiers) {
                        error(self, (at, 0), 8009, token);
                    }
                }
                StmtKind::Import(i) if hir[i].type_only => {
                    error(self, to_its_end(self, stmt.start), 8006, "import type")
                }
                StmtKind::ExportNamed(e) if hir[e].type_only => {
                    error(self, to_its_end(self, stmt.start), 8006, "export type")
                }
                StmtKind::ExportStar {
                    type_only: true, ..
                } => error(self, to_its_end(self, stmt.start), 8006, "export type"),
                StmtKind::ImportEquals(_) => error(self, to_its_end(self, stmt.start), 8002, ""),
                StmtKind::ExportAssign(_) => error(self, to_its_end(self, stmt.start), 8003, ""),
                StmtKind::Interface(i) => error(self, (hir[i].name_pos, 0), 8006, "interface"),
                // `parseAmbientExternalModuleDeclaration` (`module "m"`, `global`) does not call `checkJSSyntax`.
                StmtKind::Module(m) if matches!(hir[m].name, ModuleName::Ident(_)) => {
                    let keyword = match module_keyword(text, hir[m].name_pos) {
                        b"namespace" => "namespace",
                        _ => "module",
                    };
                    error(self, (hir[m].name_pos, 0), 8006, keyword);
                }
                StmtKind::Enum(e) => error(self, (hir[e].name_pos, 0), 8006, "enum"),
                StmtKind::TypeAlias(a) => error(self, (hir[a].name_pos, 0), 8008, ""),
                _ => {}
            }
        }
        for (index, spec) in hir.import_specs.iter().enumerate() {
            if spec.type_only {
                let end = self.end_of_import_spec(file, ImportSpecId(index as u32));
                error(self, (spec.start, end), 8006, "import...type");
            }
        }
        for (index, spec) in hir.export_specs.iter().enumerate() {
            if spec.type_only {
                let end = self.end_of_export_spec(file, ExportSpecId(index as u32));
                error(self, (spec.start, end), 8006, "export...type");
            }
        }
        for (index, e) in hir.exprs.iter().enumerate() {
            let id = ExprId(index as u32);
            match e.kind {
                ExprKind::NonNull(_) => error(
                    self,
                    (self.start_of(file, id), self.end_of_expr(file, id)),
                    8013,
                    "",
                ),
                ExprKind::As { ty, .. } => error(self, type_loc(self, ty), 8016, ""),
                ExprKind::Satisfies { ty, .. } => error(self, type_loc(self, ty), 8037, ""),
                _ => {}
            }
        }
        for call in hir.calls.iter().filter(|call| !call.type_args.is_empty()) {
            error(self, type_argument_list_loc(self, call.type_args), 8011, "");
        }
    }
}
