use super::*;

const COMMENT: (u32, u32) = (10, 40);
const IN_COMMENT: u32 = 20;
const AFTER_COMMENT: u32 = 50;

fn javascript_file(jsdoc_comments: &[(u32, u32)]) -> FileBuilder {
    FileBuilder {
        is_js: true,
        jsdoc_comments: jsdoc_comments.to_vec(),
        ..Default::default()
    }
}

fn report(mut file: FileBuilder) -> Vec<Diagnostic> {
    report_typescript_only_syntax(&mut file, b"");
    file.diagnostics
}

fn codes_and_starts(diagnostics: &[Diagnostic]) -> Vec<(u32, u32)> {
    diagnostics.iter().map(|it| (it.code, it.start)).collect()
}

#[test]
fn reparsed_this_parameter_not_reported() {
    let report_at = |pos: u32| {
        let mut file = javascript_file(&[COMMENT]);
        let end = pos + 4;
        let pat = file.pat(PatKind::Ident(known::this), pos, end);
        file.add_param(Param {
            pat,
            ty: TypeNodeId::NONE,
            default: ExprId::NONE,
            flags: Flags::empty(),
            pos,
            loc: TextRange { pos, end },
        });
        report(file)
    };
    assert!(report_at(IN_COMMENT).is_empty());
    let written = report_at(AFTER_COMMENT);
    assert_eq!(codes_and_starts(&written), [(1003, AFTER_COMMENT)]);
    assert_eq!(written[0].kind, DiagnosticKind::Js);
    assert_eq!(written[0].class, DiagnosticClass::EarlyError);
}

#[test]
fn reparsed_statement_not_reported() {
    let report_with = |jsdoc_comments: &[(u32, u32)]| {
        let mut file = javascript_file(jsdoc_comments);
        for pos in [IN_COMMENT, AFTER_COMMENT] {
            file.stmt(StmtKind::ExportAsNamespace(known::React), pos);
        }
        codes_and_starts(&report(file))
    };
    assert_eq!(report_with(&[COMMENT]), [(8006, AFTER_COMMENT)]);
    let both = [IN_COMMENT, AFTER_COMMENT].map(|pos| (8006, pos));
    assert_eq!(report_with(&[]), both);
}

#[test]
fn reparsed_member_not_reported() {
    const SECOND_STATIC: u32 = AFTER_COMMENT + 7;
    let report_with = |jsdoc_comments: &[(u32, u32)]| {
        let mut file = javascript_file(jsdoc_comments);
        let keyword = |pos| Modifier {
            kind: ModifierKind::Keyword(Flags::STATIC),
            pos,
        };
        let modifiers = file.add_modifiers(&[keyword(AFTER_COMMENT), keyword(SECOND_STATIC)]);
        for start in [IN_COMMENT, AFTER_COMMENT] {
            file.add_member(Member {
                kind: MemberKind::Method,
                key: PropKey::Name(known::next),
                flags: Flags::STATIC,
                ty: TypeNodeId::NONE,
                init: ExprId::NONE,
                func: FnId::NONE,
                name_pos: start,
                start,
                loc: TextRange::default(),
                modifiers,
            });
        }
        codes_and_starts(&report(file))
    };
    assert_eq!(report_with(&[COMMENT]), [(1042, SECOND_STATIC)]);
    assert_eq!(report_with(&[]), [(1042, SECOND_STATIC); 2]);
}
