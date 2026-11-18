//! Imports and exports.

use bun_engine_text::Text;

use super::context::is_eval_or_arguments;
use super::function::Site;
use super::statement::Position;
use super::{Class, Context, Parsed, Session, Statement};
use crate::ast::{
    BindingKind, DeclarationKind, Export, ExprKind, Import, List, ModuleRequest, StmtId, StmtKind,
};
use crate::names::Name;
use crate::token::{Token, TokenKind};

/// An element of `export { .. }`.
pub(super) struct LocalExport {
    local: Name,
    exported: Name,
}

/// What a name is used for in the module.
#[derive(Clone, Copy, Default)]
pub(super) struct Roles {
    /// The index of the import that binds it, plus one.
    import: u32,
    /// The index of the last request that it is the key of an attribute of, plus one.
    attribute_of: u32,
    is_exported: bool,
}

const AFTER_IMPORT: &str = "Expected a ';' following a targeted import declaration";
const AFTER_EXPORT: &str = "Expected a ';' following a targeted export declaration";
const DUPLICATE_EXPORT: &str = "Cannot export a duplicate name '%'";
const SECOND_DEFAULT: &str = "Only one 'default' export is allowed";

fn is_well_formed(text: Text<'_>) -> bool {
    (text.code_points()).all(|code_point| !(0xd800..=0xdfff).contains(&code_point))
}

impl Session<'_> {
    pub(super) fn module_items(&mut self) -> Parsed<List<StmtId>> {
        let list = self.open_list();
        loop {
            let statement = match self.kind() {
                TokenKind::Export => self.export()?,
                TokenKind::Import
                    if !matches!(self.peek().kind(), TokenKind::OpenParen | TokenKind::Dot) =>
                {
                    self.import()?
                }
                TokenKind::CloseBrace | TokenKind::End | TokenKind::Case | TokenKind::Default => {
                    break;
                }
                _ => self.statement::<true>(Position::InList)?,
            };
            self.append_statement::<true>(statement);
        }
        self.resolve_local_exports()?;
        Ok(self.ast.close_list(list))
    }

    /// Step 10 of ParseModule of ECMA-262.
    fn resolve_local_exports(&mut self) -> Parsed<()> {
        for index in 0..self.ast.root.module.exports.len() {
            let Export::Local { exported, local } = self.ast.root.module.exports[index] else {
                continue;
            };
            let import = self.roles(local).import as usize;
            let module = &mut self.ast.root.module;
            if let Some(&import) = module.imports.get(import.wrapping_sub(1))
                && !module.requests[import.request as usize].is_deferred
            {
                module.exports[index] = Export::Indirect {
                    exported,
                    request: import.request,
                    imported: import.imported,
                };
            } else if !self.scopes.export_binding(local) {
                return Err(self.reject_naming(
                    "Exported binding '%' needs to refer to a top-level declared variable",
                    local,
                ));
            }
        }
        Ok(())
    }

    fn roles(&mut self, name: Name) -> &mut Roles {
        let roles = &mut self.stacks.module_roles;
        if name.index() >= roles.len() {
            roles.resize(self.lexer.names.limit(), Roles::default());
        }
        &mut roles[name.index()]
    }

    /// `sentence` is for when the name is taken.
    pub(super) fn export_declaration(&mut self, name: Name, sentence: &'static str) -> Parsed<()> {
        self.claim_export(name, sentence)?;
        self.export_local(name, name);
        Ok(())
    }

    fn export_local(&mut self, local: Name, exported: Name) {
        (self.ast.root.module.exports).push(Export::Local { exported, local });
    }

    fn claim_export(&mut self, name: Name, sentence: &'static str) -> Parsed<()> {
        if core::mem::replace(&mut self.roles(name).is_exported, true) {
            return Err(self.reject_naming(sentence, name));
        }
        Ok(())
    }

    /// ModuleExportName of ECMA-262. Stays at the token.
    fn module_export_name(&mut self, sentence: &'static str) -> Parsed<Name> {
        let token = self.token();
        if token.kind().is_identifier_name() {
            return Ok(token.name());
        }
        self.require(TokenKind::String, sentence)?;
        let name = self.lexer.string_name(token);
        if !is_well_formed(self.lexer.names.text(name, self.lexer.source.text)) {
            return Err(
                self.fail("Expected a well-formed-unicode string for the module export name")
            );
        }
        Ok(name)
    }

    fn expect_contextual(&mut self, name: Name, sentence: &'static str) -> Parsed<()> {
        if !self.at_contextual(name) {
            return Err(self.fail(sentence));
        }
        self.next();
        Ok(())
    }

    /// The index that the request of the declaration at hand is going to have.
    fn next_request(&self) -> u32 {
        self.ast.root.module.requests.len() as u32
    }

    /// At the specifier.
    fn module_request(&mut self, is_deferred: bool) -> Parsed<()> {
        self.require(
            TokenKind::String,
            "Imported modules names must be string literals",
        )?;
        let specifier = self.lexer.string_name(self.token());
        self.next();
        let attributes = if self.eat(TokenKind::With) {
            self.import_attributes()?
        } else {
            List::EMPTY
        };
        self.ast.root.module.requests.push(ModuleRequest {
            specifier,
            attributes,
            is_deferred,
        });
        Ok(())
    }

    fn import_attributes(&mut self) -> Parsed<List<Option<Name>>> {
        self.expect(
            TokenKind::OpenBrace,
            "Expected opening '{' at the start of import attribute",
        )?;
        let list = self.open_list();
        while !self.at(TokenKind::CloseBrace) {
            let token = self.token();
            if !token.kind().is_identifier_name() {
                self.require(TokenKind::String, "Expected an attribute key")?;
            }
            let key = self.word_or_string(token);
            let request = self.next_request() + 1;
            if core::mem::replace(&mut self.roles(key).attribute_of, request) == request {
                return Err(self.fail_naming("A duplicate key for import attributes '%'", key));
            }
            self.next();
            self.expect(TokenKind::Colon, "Expected ':' after attribute key")?;
            self.require(TokenKind::String, "Expected an attribute value")?;
            let value = self.lexer.string_name(self.token());
            self.next();
            self.ast.push_to_list(Some(key));
            self.ast.push_to_list(Some(value));
            if !self.eat(TokenKind::Comma) {
                break;
            }
        }
        self.expect(
            TokenKind::CloseBrace,
            "Expected '}' to end an import attribute",
        )?;
        Ok(self.ast.close_list(list))
    }

    fn import(&mut self) -> Parsed<Statement> {
        let start = self.start();
        self.next();
        let mut is_deferred = false;
        if !self.at(TokenKind::String) {
            is_deferred = self.at_contextual(Name::DEFER) && self.peek().kind() == TokenKind::Star;
            if is_deferred {
                self.next();
            }
            self.import_clause()?;
            self.expect_contextual(Name::FROM, "Expected 'from' before imported module name")?;
        }
        self.module_request(is_deferred)?;
        self.expect_semicolon(AFTER_IMPORT)?;
        Ok(self.step_node::<true>(start, StmtKind::ModuleItem))
    }

    fn import_clause(&mut self) -> Parsed<()> {
        if self.at_name() {
            let local = self.token();
            self.next();
            self.declare_import(Some(Name::DEFAULT), local)?;
            if !self.eat(TokenKind::Comma) {
                return Ok(());
            }
        }
        if self.eat(TokenKind::Star) {
            self.expect_contextual(Name::AS, "Expected 'as' before imported binding name")?;
            let local = self.imported_binding()?;
            return self.declare_import(None, local);
        }
        self.expect(
            TokenKind::OpenBrace,
            "Expected namespace import or import list",
        )?;
        while !self.at(TokenKind::CloseBrace) {
            self.import_specifier()?;
            if !self.eat(TokenKind::Comma) {
                break;
            }
        }
        self.expect(TokenKind::CloseBrace, "Expected '}' to end an import list")
    }

    fn imported_binding(&mut self) -> Parsed<Token> {
        let token = self.token();
        if !self.is_name(token) {
            return Err(self.fail("Expected a variable name for the import declaration"));
        }
        self.next();
        Ok(token)
    }

    fn import_specifier(&mut self) -> Parsed<()> {
        let mut local = self.token();
        let imported = self.module_export_name(
            "Expected an imported name or a module export name string for the import declaration",
        )?;
        if local.kind() == TokenKind::EscapedKeyword && !self.peek().is_contextual(Name::AS) {
            return Err(self.unexpected());
        }
        self.next();
        if self.at_contextual(Name::AS) {
            self.next();
            local = self.imported_binding()?;
        } else if local.kind() == TokenKind::String {
            return Err(self.fail("Expected 'as' after the module export name string"));
        }
        self.declare_import(Some(imported), local)
    }

    fn declare_import(&mut self, imported: Option<Name>, local: Token) -> Parsed<()> {
        if local.spells(TokenKind::Await) {
            return Err(self.reject("Cannot use 'await' as an imported binding name"));
        }
        if local.kind().is_keyword() {
            return Err(self.reject("Cannot use keyword as imported binding name"));
        }
        let local = local.name();
        if is_eval_or_arguments(local) {
            let sentence = "Cannot declare an imported binding named % in strict mode";
            return Err(self.reject_naming(sentence, local));
        }
        let kind = match imported {
            Some(_) => BindingKind::Import,
            None => BindingKind::ImportNamespace,
        };
        let declared = self.scopes.lexical_count();
        if !self.scopes.declare_lexical(local, kind) {
            let sentence = "Cannot declare an imported binding name twice: '%'";
            return Err(self.reject_naming(sentence, local));
        }
        self.scopes.initialize_lexicals(declared, 0);
        let request = self.next_request();
        self.ast.root.module.imports.push(Import {
            request,
            imported,
            local,
        });
        self.roles(local).import = self.ast.root.module.imports.len() as u32;
        Ok(())
    }

    fn export(&mut self) -> Parsed<Statement> {
        let start = self.start();
        self.next();
        let kind = match self.kind() {
            TokenKind::Star => self.export_star()?,
            TokenKind::OpenBrace => self.export_list()?,
            TokenKind::Default => StmtKind::Export(self.export_default()?),
            _ => {
                self.context |= Context::EXPORTING;
                let declaration = self.exported_declaration()?;
                self.context -= Context::EXPORTING;
                StmtKind::Export(declaration)
            }
        };
        Ok(self.step_node::<true>(start, kind))
    }

    fn exported_name(&mut self) -> Parsed<Name> {
        let name = self.module_export_name(
            "Expected an exported name or a module export name string for the export declaration",
        )?;
        self.next();
        Ok(name)
    }

    fn export_star(&mut self) -> Parsed<StmtKind> {
        self.next();
        let mut exported = None;
        if self.at_contextual(Name::AS) {
            self.next();
            exported = Some(self.exported_name()?);
        }
        self.expect_contextual(Name::FROM, "Expected 'from' before exported module name")?;
        let request = self.next_request();
        self.module_request(false)?;
        self.expect_semicolon(AFTER_EXPORT)?;
        let export = match exported {
            Some(exported) => {
                self.claim_export(exported, DUPLICATE_EXPORT)?;
                Export::Indirect {
                    exported,
                    request,
                    imported: None,
                }
            }
            None => Export::Star { request },
        };
        self.ast.root.module.exports.push(export);
        Ok(StmtKind::ModuleItem)
    }

    fn export_list(&mut self) -> Parsed<StmtKind> {
        self.next();
        self.stacks.local_exports.clear();
        let (mut has_keyword, mut has_string) = (false, false);
        while !self.at(TokenKind::CloseBrace) {
            let kind = self.kind();
            let local = self.module_export_name(
                "Expected a variable name or a module export name string for the export declaration",
            )?;
            has_string |= kind == TokenKind::String;
            has_keyword |= kind.is_keyword() || kind == TokenKind::EscapedKeyword;
            self.next();
            let mut exported = local;
            if self.at_contextual(Name::AS) {
                self.next();
                exported = self.exported_name()?;
            }
            self.claim_export(exported, DUPLICATE_EXPORT)?;
            (self.stacks.local_exports).push(LocalExport { local, exported });
            if !self.eat(TokenKind::Comma) {
                break;
            }
        }
        self.expect(TokenKind::CloseBrace, "Expected '}' to end an export list")?;
        let mut request = None;
        if self.at_contextual(Name::FROM) {
            self.next();
            request = Some(self.next_request());
            self.module_request(false)?;
        } else if has_string {
            return Err(self.reject(
                "Cannot use module export names if they reference variable names in the current module",
            ));
        }
        self.expect_semicolon(AFTER_EXPORT)?;
        if request.is_none() && has_keyword {
            return Err(self.reject("Cannot use keyword as exported variable name"));
        }
        let exports = self.stacks.local_exports.drain(..);
        (self.ast.root.module.exports).extend(exports.map(|LocalExport { local, exported }| {
            match request {
                Some(request) => Export::Indirect {
                    exported,
                    request,
                    imported: Some(local),
                },
                None => Export::Local { exported, local },
            }
        }));
        Ok(StmtKind::ModuleItem)
    }

    fn export_default(&mut self) -> Parsed<Statement> {
        self.next();
        let start = self.start();
        let statement = if self.at(TokenKind::Class) {
            self.class_declaration::<true>(Site::DefaultExport)?
        } else if self.at(TokenKind::Function) || self.at_async_function() {
            self.eat(TokenKind::Identifier);
            self.function_declaration::<true>(start, Site::DefaultExport, None)?
        } else {
            self.export_default_expression()?
        };
        let local = match self.ast[statement].kind {
            StmtKind::Function(function) => self.ast[function].own_name,
            StmtKind::Class(class) => match self.ast[class].kind {
                ExprKind::Initialize { name, .. } => Some(name),
                _ => None,
            },
            _ => None,
        };
        self.claim_export(Name::DEFAULT, SECOND_DEFAULT)?;
        self.export_local(local.unwrap_or(Name::DEFAULT_EXPORT), Name::DEFAULT);
        Ok(statement)
    }

    fn export_default_expression(&mut self) -> Parsed<Statement> {
        let (start, name) = (self.start(), Name::DEFAULT_EXPORT);
        let value = self.assignment::<true>()?.id();
        let declared = self.scopes.lexical_count();
        if !self.scopes.declare_lexical(name, BindingKind::Const) {
            return Err(self.reject(SECOND_DEFAULT));
        }
        (self.scopes).initialize_lexicals(declared, self.lexer.previous_end);
        self.name_anonymous(value, Name::DEFAULT);
        let kind = ExprKind::Initialize {
            kind: DeclarationKind::Const,
            name,
            name_start: start,
            value,
        };
        let initialization = self.node::<true>(Class::Other, start, kind);
        self.end_expression::<true>(initialization);
        self.expect_semicolon(AFTER_EXPORT)?;
        Ok(self.statement_node::<true>(start, StmtKind::Expression(initialization.id())))
    }

    fn exported_declaration(&mut self) -> Parsed<Statement> {
        let start = self.start();
        let kind = match self.kind() {
            TokenKind::Var => DeclarationKind::Var,
            TokenKind::Let => DeclarationKind::Let,
            TokenKind::Const => DeclarationKind::Const,
            TokenKind::Class => return self.class_declaration::<true>(Site::Ordinary),
            TokenKind::Function => {
                return self.function_declaration::<true>(start, Site::Ordinary, None);
            }
            _ if self.at_contextual(Name::ASYNC) => {
                self.next();
                if !self.at(TokenKind::Function) || self.follows_newline() {
                    return Err(self.reject(
                        "Expected 'function' keyword following 'async' keyword with no preceding line terminator",
                    ));
                }
                return self.function_declaration::<true>(start, Site::Ordinary, None);
            }
            _ => return Err(self.fail("Expected either a declaration or a variable statement")),
        };
        self.next();
        self.variable_declaration::<true>(kind, start)
    }
}
