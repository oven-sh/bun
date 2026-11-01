//! An error out of making `this` has no position of its own. JSC's lookup falls on the first position that the
//! bytecode of the constructor records, in the text the transpiler prints. The source map then names the last
//! mapping that js_printer adds at or before it. A constructor is that of a class without a parent, or a plain
//! function.
//!
//! So this walks the printed tree in the order of NodesCodegen.cpp, and each arm says where
//! `emitExpressionInfo` puts the divot and which `add_source_mapping` stands before it.

use std::cell::Cell;

use bun_ast::b::B;
use bun_ast::expr::Data as ExprData;
use bun_ast::flags::Property as PropertyFlag;
use bun_ast::op::{Level, TABLE};
use bun_ast::stmt::Data as StmtData;
use bun_ast::symbol::follow_symbols;
use bun_ast::{AssignTarget, Binding, E, Expr, G, Loc, OpCode, Ref, S, Stmt, StmtOrExpr, Symbol};
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

use super::JoinedDeclarator;

#[derive(Copy, Clone)]
enum First {
    At(Loc),
    Nothing,
    Unknown,
}

impl First {
    fn or_else(self, next: impl FnOnce() -> First) -> First {
        match self {
            First::Nothing => next(),
            found => found,
        }
    }

    fn at(position: Option<Loc>) -> First {
        position.map_or(First::Unknown, First::At)
    }
}

/// How an expression is printed and used.
#[derive(Copy, Clone)]
struct Place {
    level: Level,
    /// The mapping that is added right behind the last character of the expression.
    follower: Option<Loc>,
    is_result_ignored: bool,
    /// Only whether the value is true is asked.
    is_condition: bool,
    /// JSC's parser reads a run of prefix operators in one go, and a run of binary operators. Each operator of a run
    /// has the position of the start of the run.
    prefix_run: Option<Loc>,
    binary_run: Option<Option<Loc>>,
}

impl Place {
    fn new(level: Level) -> Place {
        Place {
            level,
            follower: None,
            is_result_ignored: false,
            is_condition: false,
            prefix_run: None,
            binary_run: None,
        }
    }

    fn condition(level: Level) -> Place {
        Place {
            is_condition: true,
            ..Place::new(level)
        }
    }

    fn followed_by(self, follower: Option<Loc>) -> Place {
        Place { follower, ..self }
    }

    fn ignoring_result(self) -> Place {
        Place {
            is_result_ignored: true,
            ..self
        }
    }
}

fn valid_behind(closer: Loc, opener: Loc) -> Option<Loc> {
    (closer.start > opener.start).then_some(closer)
}

pub(super) struct Constructor<'a> {
    symbols: &'a [Symbol],
    /// Sorted by the object.
    joined_declarators: &'a [JoinedDeclarator],
    variables: &'a Variables,
    /// The number that `variables` has for the constructor.
    closure: u32,
    has_direct_eval: bool,
    arguments: Option<u32>,
    /// `arguments` is named for more than its length.
    needs_arguments: bool,
    is_strict: bool,
    /// The parameters of a sloppy function whose `arguments` object shows them: they live in that object.
    parameters_in_arguments: SmallVec<[u32; 4]>,
    depth: Cell<u32>,
}

/// What is nested deeper is not looked at: the walk calls itself.
const MAX_DEPTH: u32 = 200;

/// `None`: nothing is recorded, or this does not know the form. JSC then names the parameters.
pub(super) fn find_first_recorded_position_of_class(
    symbols: &[Symbol],
    joined_declarators: &[JoinedDeclarator],
    variables: &Variables,
    class: &G::Class,
) -> Option<u32> {
    let is_field = |property: &G::Property| {
        matches!(
            property.kind,
            G::PropertyKind::Normal | G::PropertyKind::AutoAccessor
        ) && !property.flags.contains(PropertyFlag::IsStatic)
            && !property.flags.contains(PropertyFlag::IsMethod)
    };
    let properties = class.properties.slice();
    // The call of the initializer of the fields is recorded at the parameters.
    if class.extends.is_some() || properties.iter().any(is_field) {
        return None;
    }
    let function = properties.iter().find_map(find_constructor)?;
    find_first_recorded_position(symbols, joined_declarators, variables, function, true)
}

/// The same for the function itself: the constructor of a class, or a plain function.
pub(super) fn find_first_recorded_position(
    symbols: &[Symbol],
    joined_declarators: &[JoinedDeclarator],
    variables: &Variables,
    function: &G::Fn,
    is_strict: bool,
) -> Option<u32> {
    let closure = variables.find_closure(function)?;
    let arguments = find_arguments(symbols, function);
    let needs_arguments = arguments.is_some_and(|arguments| variables.is_named(arguments));
    let mut parameters_in_arguments = SmallVec::new();
    if !is_strict && needs_arguments && has_only_plain_parameters(function) {
        for argument in function.args.slice() {
            if let B::BIdentifier(name) = argument.binding.data {
                parameters_in_arguments.push(follow_symbols(symbols, name.r#ref).inner_index());
            }
        }
    }
    let constructor = Constructor {
        symbols,
        joined_declarators,
        variables,
        closure,
        has_direct_eval: variables.holds_all_variables_in_scope[closure as usize],
        arguments,
        needs_arguments,
        is_strict,
        parameters_in_arguments,
        depth: Cell::new(0),
    };
    match constructor.first_of_function(function) {
        First::At(position) => u32::try_from(position.start).ok(),
        First::Nothing | First::Unknown => None,
    }
}

fn find_constructor(property: &G::Property) -> Option<&G::Fn> {
    let flags = property.flags;
    if !flags.contains(PropertyFlag::IsMethod)
        || flags.contains(PropertyFlag::IsStatic)
        || flags.contains(PropertyFlag::IsComputed)
        || property.kind != G::PropertyKind::Normal
    {
        return None;
    }
    let ExprData::EString(name) = &property.key.as_ref()?.data else {
        return None;
    };
    if !name.is_utf8() || name.slice8() != b"constructor" {
        return None;
    }
    match &property.value.as_ref()?.data {
        ExprData::EFunction(function) => Some(&function.func),
        _ => None,
    }
}

fn has_only_plain_parameters(function: &G::Fn) -> bool {
    let is_plain = |argument: &G::Arg| {
        argument.default.is_none() && matches!(argument.binding.data, B::BIdentifier(_))
    };
    !function.flags.contains(G::FnFlags::HasRestArg) && function.args.slice().iter().all(is_plain)
}

fn find_arguments(symbols: &[Symbol], function: &G::Fn) -> Option<u32> {
    let arguments = function.arguments_ref;
    (!arguments.is_empty()).then(|| follow_symbols(symbols, arguments).inner_index())
}

fn address_of(function: &G::Fn) -> usize {
    std::ptr::from_ref(function) as usize
}

/// Says which variables of a file live in a register: those that no closure names but the one that declares them.
/// A closure is whatever has variables of its own at run time: the file, a function, the value of a member of a class.
pub(super) struct Variables {
    /// By symbol: the closure that declares it.
    declared_in: Vec<u32>,
    /// By symbol: the closure that names it.
    named_in: Vec<u32>,
    /// By closure: it names `eval`, or a closure inside it does, or it has a `with`.
    holds_all_variables_in_scope: Vec<bool>,
    /// The closure of each function, by the address of the function.
    closures: FxHashMap<usize, u32>,
}

const NO_CLOSURE: u32 = u32::MAX;
const SEVERAL_CLOSURES: u32 = u32::MAX - 1;

impl Variables {
    /// One walk over the file, however deep its functions are nested.
    pub(super) fn of_file<'s>(
        symbols: &[Symbol],
        parts: impl Iterator<Item = &'s [Stmt]>,
    ) -> Variables {
        let mut walk = VariablesWalk {
            symbols,
            variables: Variables {
                declared_in: vec![NO_CLOSURE; symbols.len()],
                named_in: vec![NO_CLOSURE; symbols.len()],
                holds_all_variables_in_scope: vec![false],
                closures: FxHashMap::default(),
            },
            has_direct_eval: vec![false],
            open: vec![OpenClosure {
                closure: 0,
                arguments: None,
            }],
            classes: Vec::new(),
            pending: Vec::new(),
        };
        for statements in parts {
            walk.push_statements(statements);
        }
        walk.walk();
        walk.variables
    }

    fn find_closure(&self, function: &G::Fn) -> Option<u32> {
        self.closures.get(&address_of(function)).copied()
    }

    fn is_named(&self, name: u32) -> bool {
        self.named_in[name as usize] != NO_CLOSURE
    }

    fn is_variable_of_closure_alone(&self, name: u32, closure: u32) -> bool {
        let named_in = self.named_in[name as usize];
        self.declared_in[name as usize] == closure
            && (named_in == closure || named_in == NO_CLOSURE)
    }
}

enum Work {
    Expression(Expr),
    Statement(Stmt),
    Binding(Binding),
    /// The address of the function and its `arguments`, for a closure that is a function with an `arguments` of its own.
    EnterClosure(Option<(usize, Option<u32>)>),
    LeaveClosure,
    EnterClass(u32),
    LeaveClass,
}

struct OpenClosure {
    closure: u32,
    arguments: Option<u32>,
}

struct VariablesWalk<'a> {
    symbols: &'a [Symbol],
    variables: Variables,
    /// By closure.
    has_direct_eval: Vec<bool>,
    /// The closures around, the innermost last.
    open: Vec<OpenClosure>,
    /// The names of the classes around. Inside a class its name is a variable of the class.
    classes: Vec<u32>,
    /// What was pushed last is taken first.
    pending: Vec<Work>,
}

impl VariablesWalk<'_> {
    fn walk(&mut self) {
        while let Some(work) = self.pending.pop() {
            match work {
                Work::Expression(expression) => self.walk_expression(expression),
                Work::Statement(statement) => self.walk_statement(statement),
                Work::Binding(binding) => self.walk_binding(binding),
                Work::EnterClosure(function) => self.enter_closure(function),
                Work::LeaveClosure => self.leave_closure(),
                Work::EnterClass(name) => self.classes.push(name),
                Work::LeaveClass => {
                    self.classes.pop();
                }
            }
        }
    }

    fn enter_closure(&mut self, function: Option<(usize, Option<u32>)>) {
        let closure = self.has_direct_eval.len() as u32;
        self.has_direct_eval.push(false);
        self.variables.holds_all_variables_in_scope.push(false);
        let arguments = function.and_then(|(_, arguments)| arguments);
        self.open.push(OpenClosure { closure, arguments });
        if let Some((address, _)) = function {
            self.variables.closures.insert(address, closure);
        }
        if let Some(arguments) = arguments {
            self.variables.declared_in[arguments as usize] = closure;
        }
    }

    fn leave_closure(&mut self) {
        let Some(left) = self.open.pop() else {
            return;
        };
        if self.has_direct_eval[left.closure as usize] {
            self.did_find_direct_eval();
        }
    }

    fn innermost(&self) -> &OpenClosure {
        self.open.last().expect("the file is never left")
    }

    fn did_find_direct_eval(&mut self) {
        let closure = self.innermost().closure as usize;
        self.has_direct_eval[closure] = true;
        self.variables.holds_all_variables_in_scope[closure] = true;
    }

    fn follow(&self, name: Ref) -> u32 {
        follow_symbols(self.symbols, name).inner_index()
    }

    fn declare(&mut self, name: Ref) {
        if !name.is_empty() {
            let name = self.follow(name);
            self.variables.declared_in[name as usize] = self.innermost().closure;
        }
    }

    fn is_length_of_own_arguments(&self, access: &E::Dot) -> bool {
        let ExprData::EIdentifier(object) = access.target.data else {
            return false;
        };
        self.innermost().arguments == Some(self.follow(object.ref_))
            && &*access.name == b"length"
            && access.optional_chain.is_none()
    }

    fn push(&mut self, expression: Expr) {
        self.pending.push(Work::Expression(expression));
    }

    fn push_optional(&mut self, expression: Option<Expr>) {
        self.pending.extend(expression.map(Work::Expression));
    }

    fn push_expressions(&mut self, expressions: &[Expr]) {
        let expressions = expressions.iter().copied();
        self.pending.extend(expressions.map(Work::Expression));
    }

    fn push_statements(&mut self, statements: &[Stmt]) {
        let statements = statements.iter().copied();
        self.pending.extend(statements.map(Work::Statement));
    }

    fn push_arguments(&mut self, arguments: &[G::Arg]) {
        for argument in arguments {
            self.pending.push(Work::Binding(argument.binding));
            self.push_optional(argument.default);
        }
    }

    fn push_function(&mut self, function: &G::Fn) {
        self.push_arguments(function.args.slice());
        self.push_statements(function.body.stmts.slice());
    }

    fn push_closure(&mut self, push: impl FnOnce(&mut Self)) {
        self.pending.push(Work::LeaveClosure);
        push(self);
        self.pending.push(Work::EnterClosure(None));
    }

    fn push_function_as_closure(&mut self, function: &G::Fn) {
        self.pending.push(Work::LeaveClosure);
        self.push_function(function);
        let arguments = find_arguments(self.symbols, function);
        let function = (address_of(function), arguments);
        self.pending.push(Work::EnterClosure(Some(function)));
    }

    fn push_class(&mut self, class: &G::Class) {
        let name = class.class_name.as_ref().map(|name| self.follow(name.ref_));
        self.pending.extend(name.map(|_| Work::LeaveClass));
        self.push_optional(class.extends);
        for property in class.properties.slice() {
            if property.flags.contains(PropertyFlag::IsComputed) {
                self.push_optional(property.key);
            }
            // A field's initializer and a static block are functions of their own.
            self.push_closure(|variables| {
                variables.push_optional(property.value);
                variables.push_optional(property.initializer);
                if let Some(block) = property.class_static_block_ref() {
                    variables.push_statements(&block.stmts);
                }
            });
        }
        self.pending.extend(name.map(Work::EnterClass));
    }

    fn walk_binding(&mut self, binding: Binding) {
        match binding.data {
            B::BIdentifier(name) => self.declare(name.r#ref),
            B::BMissing(_) => {}
            B::BArray(array) => {
                for item in array.items() {
                    self.pending.push(Work::Binding(item.binding));
                    self.push_optional(item.default_value);
                }
            }
            B::BObject(object) => {
                for property in object.properties() {
                    self.push(property.key);
                    self.pending.push(Work::Binding(property.value));
                    self.push_optional(property.default_value);
                }
            }
        }
    }

    fn walk_expression(&mut self, expression: Expr) {
        match expression.data {
            ExprData::EIdentifier(name) => {
                let name = self.follow(name.ref_);
                // JSC's parser goes by the spelling: whoever writes `eval`, called or not, keeps every variable around it in a scope.
                if self.symbols[name as usize].original_name.slice() == b"eval" {
                    self.did_find_direct_eval();
                }
                if !self.classes.contains(&name) {
                    let closure = self.innermost().closure;
                    let named_in = &mut self.variables.named_in[name as usize];
                    *named_in = match *named_in {
                        NO_CLOSURE => closure,
                        known if known == closure => closure,
                        _ => SEVERAL_CLOSURES,
                    };
                }
            }
            ExprData::EArray(list) => self.push_expressions(&list.items),
            ExprData::EUnary(operator) => self.push(operator.value),
            ExprData::EBinary(operator) => {
                self.push(operator.left);
                self.push(operator.right);
            }
            ExprData::EClass(class) => self.push_class(&class),
            ExprData::ENew(site) => {
                self.push(site.target);
                self.push_expressions(&site.args);
            }
            ExprData::EFunction(function) => self.push_function_as_closure(&function.func),
            ExprData::ECall(site) => {
                if site.is_direct_eval {
                    self.did_find_direct_eval();
                }
                self.push(site.target);
                self.push_expressions(&site.args);
            }
            ExprData::EDot(access) => {
                if !self.is_length_of_own_arguments(&access) {
                    self.push(access.target);
                }
            }
            ExprData::EIndex(access) => {
                self.push(access.target);
                self.push(access.index);
            }
            ExprData::EArrow(arrow) => self.push_closure(|variables| {
                variables.push_arguments(arrow.args.slice());
                variables.push_statements(arrow.body.stmts.slice());
            }),
            ExprData::EObject(object) => {
                for property in object.properties.iter() {
                    self.push_optional(property.key);
                    self.push_optional(property.value);
                    self.push_optional(property.initializer);
                }
            }
            ExprData::ESpread(spread) => self.push(spread.value),
            ExprData::ETemplate(template) => {
                self.push_optional(template.tag);
                for part in template.parts() {
                    self.push(part.value);
                }
            }
            ExprData::EAwait(operator) => self.push(operator.value),
            ExprData::EYield(operator) => self.push_optional(operator.value),
            ExprData::EIf(condition) => {
                self.push(condition.test);
                self.push(condition.yes);
                self.push(condition.no);
            }
            ExprData::EImport(import) => {
                self.push(import.expr);
                self.push(import.options);
            }
            ExprData::EInlinedEnum(member) => self.push(member.value),
            _ => {}
        }
    }

    fn walk_statement(&mut self, statement: Stmt) {
        let push_statement = |variables: &mut Self, statement: Stmt| {
            variables.pending.push(Work::Statement(statement));
        };
        match statement.data {
            StmtData::SBlock(block) => self.push_statements(block.stmts.slice()),
            StmtData::SExpr(statement) => self.push(statement.value),
            StmtData::SLocal(local) => {
                for declaration in local.decls.iter() {
                    self.pending.push(Work::Binding(declaration.binding));
                    self.push_optional(declaration.value);
                }
            }
            StmtData::SReturn(returned) => self.push_optional(returned.value),
            StmtData::SThrow(statement) => self.push(statement.value),
            StmtData::SIf(statement) => {
                self.push(statement.test);
                push_statement(self, statement.yes);
                self.pending.extend(statement.no.map(Work::Statement));
            }
            StmtData::SFor(statement) => {
                self.pending.extend(statement.init.map(Work::Statement));
                self.push_optional(statement.test);
                self.push_optional(statement.update);
                push_statement(self, statement.body);
            }
            StmtData::SForIn(statement) => {
                push_statement(self, statement.init);
                self.push(statement.value);
                push_statement(self, statement.body);
            }
            StmtData::SForOf(statement) => {
                push_statement(self, statement.init);
                self.push(statement.value);
                push_statement(self, statement.body);
            }
            StmtData::SWhile(statement) => {
                self.push(statement.test);
                push_statement(self, statement.body);
            }
            StmtData::SDoWhile(statement) => {
                push_statement(self, statement.body);
                self.push(statement.test);
            }
            StmtData::SSwitch(statement) => {
                self.push(statement.test);
                for case in statement.cases.slice() {
                    self.push_optional(case.value);
                    self.push_statements(case.body.slice());
                }
            }
            StmtData::STry(statement) => {
                self.push_statements(statement.body.slice());
                if let Some(handler) = &statement.catch {
                    self.pending.extend(handler.binding.map(Work::Binding));
                    self.push_statements(handler.body.slice());
                }
                if let Some(finalizer) = &statement.finally {
                    self.push_statements(finalizer.stmts.slice());
                }
            }
            StmtData::SLabel(statement) => push_statement(self, statement.stmt),
            StmtData::SFunction(statement) => {
                if let Some(name) = &statement.func.name {
                    self.declare(name.ref_);
                }
                self.push_function_as_closure(&statement.func);
            }
            StmtData::SClass(statement) => {
                if let Some(name) = &statement.class.class_name {
                    self.declare(name.ref_);
                }
                self.push_class(&statement.class);
            }
            StmtData::SWith(statement) => {
                let closure = self.innermost().closure as usize;
                self.variables.holds_all_variables_in_scope[closure] = true;
                self.push(statement.value);
                push_statement(self, statement.body);
            }
            StmtData::SExportDefault(statement) => match statement.value {
                StmtOrExpr::Stmt(value) => push_statement(self, value),
                StmtOrExpr::Expr(value) => self.push(value),
            },
            StmtData::SExportEquals(statement) => self.push(statement.value),
            _ => {}
        }
    }
}

/// The mapping at the first character that is printed for the expression.
fn first_mapping(mut expression: Expr) -> Option<Loc> {
    loop {
        expression = match expression.data {
            ExprData::EDot(access) => access.target,
            ExprData::EIndex(access) => access.target,
            ExprData::ECall(site) => site.target,
            ExprData::EBinary(operator) => operator.left,
            ExprData::EIf(condition) => condition.test,
            ExprData::EUnary(operator) if !OpCode::is_prefix(operator.op) => operator.value,
            ExprData::EFunction(_) | ExprData::EArrow(_) | ExprData::EObject(_) => return None,
            _ => return Some(expression.loc),
        };
    }
}

/// The last mapping that is added while the expression is printed.
fn last_mapping(mut expression: Expr) -> Option<Loc> {
    // A callee and the tag of a template are printed at `Level::Postfix` or above.
    let mut is_callee = false;
    loop {
        let start = expression.loc;
        let was_callee = std::mem::take(&mut is_callee);
        expression = match expression.data {
            ExprData::EThis(_)
            | ExprData::ESuper(_)
            | ExprData::ENull(_)
            | ExprData::EUndefined(_)
            | ExprData::EBoolean(_)
            | ExprData::EBranchBoolean(_)
            | ExprData::ENumber(_)
            | ExprData::EBigInt(_)
            | ExprData::EString(_)
            | ExprData::ERegExp(_)
            | ExprData::ENewTarget(_)
            | ExprData::EImportMeta(_)
            | ExprData::EImportMetaMain(_)
            | ExprData::EIdentifier(_)
            | ExprData::EImportIdentifier(_)
            | ExprData::ECommonjsExportIdentifier(_)
            | ExprData::ENameOfSymbol(_)
            | ExprData::ESpecial(E::Special::ModuleExports)
            | ExprData::ERequireMain
            | ExprData::ERequireCallTarget
            | ExprData::ERequireResolveCallTarget
            | ExprData::ERequireString(_)
            | ExprData::ERequireResolveString(_) => return Some(start),
            ExprData::EDot(access) => return Some(access.name_loc),
            ExprData::EObject(object) => return valid_behind(object.close_brace_loc, start),
            ExprData::EClass(class) => return valid_behind(class.close_brace_loc, class.body_loc),
            ExprData::EIndex(access) => access.index,
            ExprData::EUnary(operator) => operator.value,
            ExprData::EBinary(operator) => operator.right,
            ExprData::EIf(condition) => condition.no,
            ExprData::ESpread(spread) => spread.value,
            ExprData::ECall(site) => match valid_behind(site.close_paren_loc, start) {
                Some(closer) => return Some(closer),
                None => {
                    is_callee = site.args.is_empty();
                    *site.args.last().unwrap_or(&site.target)
                }
            },
            // Without arguments the parentheses are printed only from `Level::Postfix` on.
            ExprData::ENew(site) => match valid_behind(site.close_parens_loc, start) {
                Some(closer) if !site.args.is_empty() || was_callee => return Some(closer),
                _ => {
                    is_callee = site.args.is_empty();
                    *site.args.last().unwrap_or(&site.target)
                }
            },
            ExprData::EAwait(operator) => operator.value,
            ExprData::EYield(operator) => match operator.value {
                Some(value) => value,
                None => return Some(start),
            },
            ExprData::EInlinedEnum(member) => member.value,
            ExprData::ETemplate(template) => match (template.parts().last(), template.tag) {
                (Some(part), _) => part.value,
                (None, Some(tag)) => {
                    is_callee = true;
                    tag
                }
                (None, None) => return Some(start),
            },
            // The path of a module that was found is printed without a mapping.
            ExprData::EImport(import) if !import.options.is_missing() => import.options,
            ExprData::EImport(import) if import.is_import_record_null() => import.expr,
            ExprData::EImport(_) => return Some(start),
            ExprData::EArray(list) => match valid_behind(list.close_bracket_loc, start) {
                Some(closer) => return Some(closer),
                None => match list.items.last() {
                    Some(&last) => last,
                    None => return Some(start),
                },
            },
            ExprData::EFunction(function) => {
                let body = &function.func.body;
                match find_end_of_block(body.loc, body.stmts.slice()) {
                    End::Value(value) => value,
                    End::Mapping(position) => return position,
                }
            }
            ExprData::EArrow(arrow) => {
                match find_end_of_block(arrow.body.loc, arrow.body.stmts.slice()) {
                    End::Value(value) => value,
                    End::Mapping(position) => return position,
                }
            }
            _ => return None,
        };
    }
}

fn last_mapping_of_binding(mut binding: Binding) -> Option<Loc> {
    loop {
        let (default, last) = match binding.data {
            B::BMissing(_) => return None,
            B::BIdentifier(_) => return Some(binding.loc),
            B::BArray(array) => {
                let last = array.items().last()?;
                (last.default_value, last.binding)
            }
            B::BObject(object) => {
                let last = object.properties().last()?;
                (last.default_value, last.value)
            }
        };
        if let Some(default) = default {
            return last_mapping(default);
        }
        binding = last;
    }
}

enum End {
    /// The expression that is printed last.
    Value(Expr),
    Mapping(Option<Loc>),
}

/// The `;` that stands for the body of a loop or a branch has no position, so no mapping is added for it.
fn is_unmapped(statement: Stmt) -> bool {
    matches!(statement.data, StmtData::SEmpty(_)) && statement.loc.start < 0
}

/// What is printed last in a block whose `}` has no mapping. `brace`: its `{`.
fn find_end_of_block(mut brace: Loc, mut statements: &[Stmt]) -> End {
    'block: loop {
        let Some(&last) = statements.last() else {
            return End::Mapping(Some(brace));
        };
        let mut statement = last;
        loop {
            statement = match statement.data {
                StmtData::SExpr(last) => return End::Value(last.value),
                StmtData::SThrow(last) => return End::Value(last.value),
                StmtData::SDoWhile(last) => return End::Value(last.test),
                StmtData::SReturn(last) => {
                    return last
                        .value
                        .map_or(End::Mapping(Some(statement.loc)), End::Value);
                }
                StmtData::SBreak(_)
                | StmtData::SContinue(_)
                | StmtData::SDebugger(_)
                | StmtData::SEmpty(_) => return End::Mapping(Some(statement.loc)),
                StmtData::SLocal(local) => {
                    let Some(last) = local.decls.last() else {
                        return End::Mapping(None);
                    };
                    let binding = || End::Mapping(last_mapping_of_binding(last.binding));
                    return last.value.map_or_else(binding, End::Value);
                }
                StmtData::SClass(last) => {
                    let class = &last.class;
                    return End::Mapping(valid_behind(class.close_brace_loc, class.body_loc));
                }
                StmtData::SBlock(block) => {
                    if let Some(closer) = valid_behind(block.close_brace_loc, statement.loc) {
                        return End::Mapping(Some(closer));
                    }
                    (brace, statements) = (statement.loc, block.stmts.slice());
                    continue 'block;
                }
                StmtData::SIf(branch) => match branch.no.filter(|&no| !is_unmapped(no)) {
                    // No mapping is added for the `}` behind `else`.
                    Some(Stmt {
                        data: StmtData::SBlock(block),
                        loc,
                    }) => {
                        (brace, statements) = (loc, block.stmts.slice());
                        continue 'block;
                    }
                    Some(no) => no,
                    None if is_unmapped(branch.yes) => return End::Value(branch.test),
                    None => branch.yes,
                },
                StmtData::SFor(repeated) if is_unmapped(repeated.body) => {
                    match (repeated.update.or(repeated.test), repeated.init) {
                        (Some(last), _) => return End::Value(last),
                        (None, Some(init)) => init,
                        (None, None) => return End::Mapping(Some(statement.loc)),
                    }
                }
                StmtData::SForIn(repeated) if is_unmapped(repeated.body) => {
                    return End::Value(repeated.value);
                }
                StmtData::SForOf(repeated) if is_unmapped(repeated.body) => {
                    return End::Value(repeated.value);
                }
                StmtData::SWhile(repeated) if is_unmapped(repeated.body) => {
                    return End::Value(repeated.test);
                }
                StmtData::SLabel(labeled) if is_unmapped(labeled.stmt) => {
                    return End::Mapping(Some(statement.loc));
                }
                StmtData::SFor(repeated) => repeated.body,
                StmtData::SForIn(repeated) => repeated.body,
                StmtData::SForOf(repeated) => repeated.body,
                StmtData::SWhile(repeated) => repeated.body,
                StmtData::SLabel(labeled) => labeled.stmt,
                StmtData::STry(attempt) => {
                    (brace, statements) = match (&attempt.finally, &attempt.catch) {
                        (Some(finalizer), _) => (finalizer.body_loc, finalizer.stmts.slice()),
                        (None, Some(handler)) => (handler.body_loc, handler.body.slice()),
                        (None, None) => (attempt.body_loc, attempt.body.slice()),
                    };
                    continue 'block;
                }
                StmtData::SFunction(declared) => {
                    let body = &declared.func.body;
                    (brace, statements) = (body.loc, body.stmts.slice());
                    continue 'block;
                }
                StmtData::SSwitch(switch) => {
                    let Some(case) = switch.cases.slice().last() else {
                        return End::Value(switch.test);
                    };
                    if case.body.slice().is_empty() {
                        return case.value.map_or(End::Mapping(Some(case.loc)), End::Value);
                    }
                    statements = case.body.slice();
                    continue 'block;
                }
                _ => return End::Mapping(None),
            };
        }
    }
}

/// JSC's parser folds the `-` in front of a BigInt.
fn is_big_int_literal(mut expression: Expr) -> bool {
    loop {
        expression = match expression.data {
            ExprData::EBigInt(_) => return true,
            ExprData::EUnary(operator) if operator.op == OpCode::UnNeg => operator.value,
            _ => return false,
        };
    }
}

fn is_string(mut expression: Expr) -> bool {
    loop {
        expression = match expression.data {
            ExprData::EString(_) => return true,
            ExprData::EUnary(operator) => return operator.op == OpCode::UnTypeof,
            ExprData::EBinary(operator) if operator.op == OpCode::BinAdd => {
                match operator.right.data {
                    ExprData::EString(_) => return true,
                    ExprData::EUnary(right) if right.op == OpCode::UnTypeof => return true,
                    _ => operator.left,
                }
            }
            _ => return false,
        };
    }
}

fn is_key(property: &G::Property, name: &[u8]) -> bool {
    match property.key.map(|key| key.data) {
        Some(ExprData::EString(key)) => key.is_utf8() && key.slice8() == name,
        _ => false,
    }
}

impl Constructor<'_> {
    fn nested(&self, find: impl FnOnce() -> First) -> First {
        let depth = self.depth.get();
        if depth >= MAX_DEPTH {
            return First::Unknown;
        }
        self.depth.set(depth + 1);
        let found = find();
        self.depth.set(depth);
        found
    }

    fn is_in_register(&self, name: Ref) -> bool {
        let name = follow_symbols(self.symbols, name).inner_index();
        !self.has_direct_eval
            && !self.parameters_in_arguments.contains(&name)
            && self
                .variables
                .is_variable_of_closure_alone(name, self.closure)
    }

    fn name_of(&self, name: Ref) -> &[u8] {
        let name = follow_symbols(self.symbols, name);
        self.symbols[name.inner_index() as usize]
            .original_name
            .slice()
    }

    fn is_arguments_length(&self, access: &E::Dot) -> bool {
        let ExprData::EIdentifier(object) = access.target.data else {
            return false;
        };
        let object = follow_symbols(self.symbols, object.ref_).inner_index();
        self.arguments == Some(object)
            && &*access.name == b"length"
            && access.optional_chain.is_none()
    }

    fn first_of_function(&self, function: &G::Fn) -> First {
        let arguments = function.args.slice();
        // Parameters that are plain names are not bound one by one.
        if has_only_plain_parameters(function) {
            return self.first_of_statements(function.body.stmts.slice());
        }
        let mut previous = Some(function.open_parens_loc);
        for argument in arguments {
            let found = self
                .first_of_optional(argument.default, Place::new(Level::Comma))
                .or_else(|| self.first_of_binding(argument.binding, previous));
            match found {
                First::Nothing => {}
                found => return found,
            }
            previous = match argument.default {
                Some(default) => last_mapping(default),
                None => last_mapping_of_binding(argument.binding),
            };
        }
        self.first_of_statements(function.body.stmts.slice())
    }

    /// What storing into the binding records. `previous`: the last mapping in front of the binding.
    fn first_of_binding(&self, binding: Binding, previous: Option<Loc>) -> First {
        self.nested(|| self.first_of_binding_at(binding, previous))
    }

    fn first_of_binding_at(&self, binding: Binding, previous: Option<Loc>) -> First {
        match binding.data {
            B::BMissing(_) => First::Nothing,
            B::BIdentifier(name) if self.is_in_register(name.r#ref) => First::Nothing,
            B::BIdentifier(_) => First::At(binding.loc),
            // The divot is the `[`, which has no mapping.
            B::BArray(_) => First::at(previous),
            B::BObject(object) => {
                for property in object.properties() {
                    // Copying the rest is recorded at the `{`, which has no mapping.
                    if property.flags.contains(PropertyFlag::IsSpread) {
                        return First::at(previous);
                    }
                    let is_computed = property.flags.contains(PropertyFlag::IsComputed);
                    let place = Place::new(Level::Comma);
                    let key = if is_computed {
                        self.first_of(property.key, place)
                    } else {
                        First::Nothing
                    };
                    let found = key
                        .or_else(|| self.first_of_optional(property.default_value, place))
                        .or_else(|| {
                            self.first_of_binding(property.value, last_mapping(property.key))
                        });
                    match found {
                        First::Nothing => {}
                        found => return found,
                    }
                }
                First::Nothing
            }
        }
    }

    /// What storing into the target of a destructuring assignment records.
    fn first_of_target(&self, target: Expr, default: Option<Expr>) -> First {
        self.nested(|| self.first_of_target_at(target, default))
    }

    fn first_of_target_at(&self, target: Expr, default: Option<Expr>) -> First {
        let place = Place::new(Level::Comma);
        let default = || self.first_of_optional(default, place);
        match target.data {
            ExprData::EMissing(_) => First::Nothing,
            ExprData::EBinary(assignment) if assignment.op == OpCode::BinAssign => {
                self.first_of_target(assignment.left, Some(assignment.right))
            }
            ExprData::EIdentifier(name) if self.is_in_register(name.ref_) => default(),
            ExprData::EIdentifier(_) => default().or_else(|| First::At(target.loc)),
            // The object and the key come before the value is read. The divot of the store is the end of the target.
            ExprData::EDot(access) => self
                .first_of(access.target, Place::new(Level::Postfix))
                .or_else(default)
                .or_else(|| First::at(last_mapping(target))),
            ExprData::EIndex(access) => self
                .first_of(access.target, Place::new(Level::Postfix))
                .or_else(|| self.first_of(access.index, Place::new(Level::Lowest)))
                .or_else(default)
                .or_else(|| First::at(last_mapping(target))),
            ExprData::EArray(_) => default().or_else(|| First::At(target.loc)),
            ExprData::EObject(object) => default().or_else(|| {
                for property in object.properties.iter() {
                    let Some(value) = property.value else {
                        return First::Unknown;
                    };
                    if property.kind == G::PropertyKind::Spread {
                        return self.first_of_rest_target(value, target.loc);
                    }
                    let key = match property.key {
                        Some(key) if property.flags.contains(PropertyFlag::IsComputed) => {
                            self.first_of(key, place)
                        }
                        _ => First::Nothing,
                    };
                    match key.or_else(|| self.first_of_target(value, property.initializer)) {
                        First::Nothing => {}
                        found => return found,
                    }
                }
                First::Nothing
            }),
            _ => First::Unknown,
        }
    }

    fn first_of_statements(&self, statements: &[Stmt]) -> First {
        for &statement in statements {
            match self.first_of_statement(statement) {
                First::Nothing => {}
                found => return found,
            }
        }
        First::Nothing
    }

    fn first_of_optional_statement(&self, statement: Option<Stmt>) -> First {
        statement.map_or(First::Nothing, |statement| {
            self.first_of_statement(statement)
        })
    }

    fn first_of_optional(&self, expression: Option<Expr>, place: Place) -> First {
        expression.map_or(First::Nothing, |expression| {
            self.first_of(expression, place)
        })
    }

    /// `keyword`: the last mapping in front of the first declaration.
    fn first_of_declarations(&self, keyword: Loc, local: &S::Local) -> First {
        let mut previous = Some(keyword);
        for declaration in local.decls.iter() {
            let binding = declaration.binding;
            // `let a;` stores undefined, and that is not recorded.
            let Some(value) = declaration.value else {
                previous = last_mapping_of_binding(binding);
                continue;
            };
            let place = Place::new(Level::Comma);
            let printed_object = self.find_printed_object(value);
            let found = match binding.data {
                _ if printed_object.is_some() && !local.kind.is_using() => {
                    First::at(printed_object)
                }
                // Asking for the method that disposes of it is recorded at the name.
                B::BIdentifier(_) if local.kind.is_using() => self
                    .first_of_binding(binding, None)
                    .or_else(|| self.first_of(value, place))
                    .or_else(|| First::At(binding.loc)),
                // In strict code the name is recorded before its scope is looked for.
                B::BIdentifier(_) if self.is_strict => self
                    .first_of_binding(binding, None)
                    .or_else(|| self.first_of(value, place)),
                // In sloppy code only the store is recorded, which comes behind the value.
                B::BIdentifier(_) => self
                    .first_of(value, place)
                    .or_else(|| self.first_of_binding(binding, None)),
                _ => self
                    .first_of(value, place)
                    .or_else(|| self.first_of_binding(binding, previous)),
            };
            match found {
                First::Nothing => {}
                found => return found,
            }
            previous = last_mapping(value);
        }
        First::Nothing
    }

    /// `({ ...target } = ..)`. The object and the key of the target come first. The copy of the properties is a call,
    /// which is recorded at the `{` of the pattern.
    fn first_of_rest_target(&self, target: Expr, brace: Loc) -> First {
        match target.data {
            ExprData::EDot(_) | ExprData::EIndex(_) => self.first_of_target(target, None),
            _ => First::At(brace),
        }
    }

    /// `a = o.x, b = o.y` is printed `{ x: a, y: b } = o`: the `o` that is printed.
    fn find_printed_object(&self, value: Expr) -> Option<Loc> {
        let ExprData::EDot(access) = value.data else {
            return None;
        };
        let object = u32::try_from(access.target.loc.start).ok()?;
        let joined = self.joined_declarators;
        let index = joined.binary_search_by_key(&object, |declarator| declarator.object);
        let start = i32::try_from(joined[index.ok()?].printed_object).ok()?;
        Some(Loc { start })
    }

    /// What storing into the variable of `for (.. in ..)` records.
    fn first_of_loop_variable(&self, repeated: Loc, init: Stmt) -> First {
        match init.data {
            StmtData::SLocal(local) => match &local.decls[..] {
                [declaration] => self.first_of_binding(declaration.binding, Some(repeated)),
                _ => First::Unknown,
            },
            StmtData::SExpr(statement) => match statement.value.data {
                ExprData::EIdentifier(_) | ExprData::EObject(_) | ExprData::EArray(_) => {
                    self.first_of_target(statement.value, None)
                }
                _ => self
                    .first_of_member(statement.value)
                    .unwrap_or(First::Unknown),
            },
            _ => First::Unknown,
        }
    }

    fn last_mapping_of_loop_variable(&self, init: Stmt) -> Option<Loc> {
        match init.data {
            StmtData::SLocal(local) => match &local.decls[..] {
                [declaration] => last_mapping_of_binding(declaration.binding),
                _ => None,
            },
            StmtData::SExpr(statement) => last_mapping(statement.value),
            _ => None,
        }
    }

    fn first_of_statement(&self, statement: Stmt) -> First {
        self.nested(|| self.first_of_statement_at(statement))
    }

    fn first_of_statement_at(&self, statement: Stmt) -> First {
        let lowest = Place::new(Level::Lowest);
        let condition = Place::condition(Level::Lowest);
        match statement.data {
            StmtData::SEmpty(_)
            | StmtData::SComment(_)
            | StmtData::SDirective(_)
            | StmtData::SDebugger(_)
            | StmtData::SBreak(_)
            | StmtData::SContinue(_)
            | StmtData::SFunction(_)
            | StmtData::STypeScript(_) => First::Nothing,
            StmtData::SBlock(block) => self.first_of_statements(block.stmts.slice()),
            StmtData::SExpr(statement) => self.first_of(statement.value, lowest.ignoring_result()),
            StmtData::SLocal(local) => self.first_of_declarations(statement.loc, &local),
            StmtData::SReturn(returned) => self.first_of_optional(returned.value, lowest),
            // Entering the scope is recorded at the end of the object.
            StmtData::SWith(entered) => self
                .first_of(entered.value, lowest)
                .or_else(|| First::at(last_mapping(entered.value))),
            // The divot is the end of the value.
            StmtData::SThrow(thrown) => self
                .first_of(thrown.value, lowest)
                .or_else(|| First::at(last_mapping(thrown.value))),
            StmtData::SIf(branch) => self
                .first_of(branch.test, condition)
                .or_else(|| self.first_of_statement(branch.yes))
                .or_else(|| self.first_of_optional_statement(branch.no)),
            StmtData::SFor(repeated) => {
                let init = match repeated.init.map(|init| init.data) {
                    // No mapping is added for `let`.
                    Some(StmtData::SLocal(local)) => {
                        self.first_of_declarations(statement.loc, &local)
                    }
                    _ => self.first_of_optional_statement(repeated.init),
                };
                init.or_else(|| self.first_of_optional(repeated.test, condition))
                    .or_else(|| self.first_of_statement(repeated.body))
                    .or_else(|| self.first_of_optional(repeated.update, lowest.ignoring_result()))
            }
            StmtData::SForIn(repeated) => self
                .first_of(repeated.value, lowest)
                .or_else(|| self.first_of_loop_variable(statement.loc, repeated.init))
                .or_else(|| self.first_of_statement(repeated.body)),
            // Asking for the iterator is recorded at the end of what stands before `of`.
            StmtData::SForOf(repeated) => self
                .first_of(repeated.value, Place::new(Level::Comma))
                .or_else(|| First::at(self.last_mapping_of_loop_variable(repeated.init))),
            StmtData::SWhile(repeated) => self
                .first_of(repeated.test, condition)
                .or_else(|| self.first_of_statement(repeated.body)),
            StmtData::SDoWhile(repeated) => self
                .first_of_statement(repeated.body)
                .or_else(|| self.first_of(repeated.test, condition)),
            StmtData::SSwitch(switch) => self.first_of(switch.test, lowest).or_else(|| {
                let cases = switch.cases.slice();
                for case in cases {
                    match self.first_of_optional(case.value, lowest) {
                        First::Nothing => {}
                        found => return found,
                    }
                }
                for case in cases {
                    match self.first_of_statements(case.body.slice()) {
                        First::Nothing => {}
                        found => return found,
                    }
                }
                First::Nothing
            }),
            StmtData::STry(attempt) => self
                .first_of_statements(attempt.body.slice())
                .or_else(|| match &attempt.catch {
                    Some(handler) => handler
                        .binding
                        .map_or(First::Nothing, |binding| {
                            self.first_of_binding(binding, Some(handler.loc))
                        })
                        .or_else(|| self.first_of_statements(handler.body.slice())),
                    None => First::Nothing,
                })
                .or_else(|| match &attempt.finally {
                    Some(finalizer) => self.first_of_statements(finalizer.stmts.slice()),
                    None => First::Nothing,
                }),
            StmtData::SLabel(labeled) => self.first_of_statement(labeled.stmt),
            StmtData::SClass(declared) => {
                let class = &declared.class;
                match class.class_name.as_ref() {
                    // The divot lies the length of the name behind `class`, and the name six characters behind it.
                    Some(name) if !self.is_in_register(name.ref_) => {
                        let reaches_name = self.name_of(name.ref_).len() >= b"class ".len();
                        First::At(if reaches_name {
                            name.loc
                        } else {
                            statement.loc
                        })
                    }
                    _ => self.first_of_class(class, statement.loc),
                }
            }
            _ => First::Unknown,
        }
    }

    fn first_of_class(&self, class: &G::Class, start: Loc) -> First {
        match class.extends {
            // That the parent is a constructor is tested at its end.
            Some(parent) => self
                .first_of(parent, Place::new(Level::New.sub(1)))
                .or_else(|| First::at(last_mapping(parent))),
            // Defining `prototype` is recorded at the start of the class.
            None => First::At(start),
        }
    }

    fn first_of_list(&self, items: &[Expr], closer: Option<Loc>) -> First {
        let place = Place::new(Level::Comma);
        for (index, &item) in items.iter().enumerate() {
            let is_last = index + 1 == items.len();
            let follower = if is_last { closer } else { None };
            match self.first_of(item, place.followed_by(follower)) {
                First::Nothing => {}
                found => return found,
            }
        }
        First::Nothing
    }

    /// The object of a member and then the key.
    fn first_of_object_and_key(&self, member: Expr) -> Option<(First, Expr)> {
        let postfix = Place::new(Level::Postfix);
        match member.data {
            ExprData::EDot(access) => Some((self.first_of(access.target, postfix), access.target)),
            ExprData::EIndex(access) => {
                let found = self
                    .first_of(access.target, postfix)
                    .or_else(|| self.first_of(access.index, Place::new(Level::Lowest)));
                Some((found, access.target))
            }
            _ => None,
        }
    }

    /// The object of a member, then the key, then the access: its divot is the end of the object.
    fn first_of_member(&self, member: Expr) -> Option<First> {
        let (found, object) = self.first_of_object_and_key(member)?;
        Some(found.or_else(|| First::at(last_mapping(object))))
    }

    fn first_of_object(&self, object: &E::Object, start: Loc) -> First {
        let properties = &object.properties[..];
        let place = Place::new(Level::Comma);
        let is_accessor = |property: &G::Property| {
            matches!(property.kind, G::PropertyKind::Get | G::PropertyKind::Set)
        };
        for (index, property) in properties.iter().enumerate() {
            let Some(value) = property.value else {
                return First::Unknown;
            };
            let rest = &properties[index + 1..];
            let is_computed = property.flags.contains(PropertyFlag::IsComputed);
            let is_method = property.flags.contains(PropertyFlag::IsMethod);
            let found = if property.kind == G::PropertyKind::Spread {
                // An object that begins with a spread begins as a copy, which is recorded at the `{`.
                let is_copy = index == 0 && !rest.iter().any(is_accessor);
                self.first_of(value, place).or_else(|| {
                    First::at(if is_copy {
                        Some(start)
                    } else {
                        first_mapping(value)
                    })
                })
            } else if let (Some(_), Some(key)) = (self.find_shorthand_name(property), property.key)
            {
                // A space or a line break is printed behind the name.
                First::At(key.loc)
            } else if is_computed {
                self.first_of_optional(property.key, place)
                    .or_else(|| self.first_of(value, place))
            } else if !is_method && is_key(property, b"__proto__") {
                // The first property has the position of the `{`.
                let position = if index == 0 {
                    Some(start)
                } else {
                    property.key.map(|key| key.loc)
                };
                self.first_of(value, place).or_else(|| First::at(position))
            } else {
                self.first_of(value, place)
            };
            match found {
                First::Nothing => {}
                found => return found,
            }
        }
        First::Nothing
    }

    fn find_shorthand_name(&self, property: &G::Property) -> Option<&[u8]> {
        if property.kind != G::PropertyKind::Normal
            || property.flags.contains(PropertyFlag::IsComputed)
        {
            return None;
        }
        let name = match property.value.as_ref()?.data {
            ExprData::EIdentifier(name) => self.name_of(name.ref_),
            ExprData::EImportIdentifier(name) => self.name_of(name.ref_),
            _ => return None,
        };
        is_key(property, name).then_some(name)
    }

    fn first_of(&self, expression: Expr, place: Place) -> First {
        self.nested(|| self.first_of_at(expression, place))
    }

    fn first_of_at(&self, expression: Expr, place: Place) -> First {
        let named = || First::At(place.follower.unwrap_or(expression.loc));
        match expression.data {
            ExprData::EMissing(_)
            | ExprData::EThis(_)
            | ExprData::ESuper(_)
            | ExprData::ENull(_)
            | ExprData::EUndefined(_)
            | ExprData::EBoolean(_)
            | ExprData::EBranchBoolean(_)
            | ExprData::EBigInt(_)
            | ExprData::EString(_)
            | ExprData::ERegExp(_)
            | ExprData::ENewTarget(_)
            | ExprData::EPrivateIdentifier(_)
            | ExprData::EFunction(_)
            | ExprData::EArrow(_) => First::Nothing,
            // `NaN` is a name.
            ExprData::ENumber(number) if number.value().is_nan() => named(),
            ExprData::ENumber(_) => First::Nothing,
            ExprData::EInlinedEnum(member) => self.first_of(member.value, Place::new(place.level)),
            ExprData::EIdentifier(_)
            | ExprData::EImportIdentifier(_)
            | ExprData::ERequireCallTarget => named(),
            // Each begins with a name, and something is printed behind that name.
            ExprData::ECommonjsExportIdentifier(_)
            | ExprData::EImportMeta(_)
            | ExprData::EImportMetaMain(_)
            | ExprData::ERequireMain
            | ExprData::ERequireString(_)
            | ExprData::ERequireResolveString(_)
            | ExprData::ERequireResolveCallTarget => First::At(expression.loc),
            ExprData::EImport(import) => self
                .first_of(import.expr, Place::new(Level::Comma))
                .or_else(|| First::At(expression.loc)),
            ExprData::EClass(class) => self.first_of_class(&class, expression.loc),
            ExprData::EArray(list) => {
                let closer = valid_behind(list.close_bracket_loc, expression.loc);
                let closer = closer.filter(|_| list.is_single_line);
                self.first_of_list(&list.items, closer)
            }
            ExprData::EObject(object) => self.first_of_object(&object, expression.loc),
            // The divot is the end of the `...`.
            ExprData::ESpread(spread) => self
                .first_of(
                    spread.value,
                    Place::new(Level::Comma).followed_by(place.follower),
                )
                .or_else(|| First::at(first_mapping(spread.value))),
            ExprData::EDot(access)
                if self.is_arguments_length(&access)
                    && !self.needs_arguments
                    && !self.has_direct_eval =>
            {
                First::Nothing
            }
            ExprData::EDot(_) | ExprData::EIndex(_) => {
                self.first_of_member(expression).unwrap_or(First::Unknown)
            }
            ExprData::ECall(site) => self.first_of_call(expression, &site),
            ExprData::ENew(site) => {
                if let Some(position) = self.find_tag_behind_new(expression) {
                    return First::At(position);
                }
                let is_wrapped = place.level.gte(Level::Call);
                let has_parentheses = !site.args.is_empty() || place.level.gte(Level::Postfix);
                let follower = place.follower.filter(|_| !is_wrapped && !has_parentheses);
                let closer = valid_behind(site.close_parens_loc, expression.loc);
                self.first_of(site.target, Place::new(Level::New).followed_by(follower))
                    .or_else(|| self.first_of_list(&site.args, closer))
                    // The divot is the end of the callee, and without parentheses the `new`.
                    .or_else(|| {
                        First::at(if has_parentheses {
                            last_mapping(site.target)
                        } else {
                            Some(expression.loc)
                        })
                    })
            }
            ExprData::ETemplate(template) => self.first_of_template(&template),
            ExprData::EIf(condition) => {
                let is_wrapped = place.level.gte(Level::Conditional);
                let follower = place.follower.filter(|_| !is_wrapped);
                self.first_of(condition.test, Place::condition(Level::Conditional))
                    .or_else(|| self.first_of(condition.yes, Place::new(Level::Yield)))
                    .or_else(|| {
                        self.first_of(condition.no, Place::new(Level::Yield).followed_by(follower))
                    })
            }
            ExprData::EUnary(operator) => self.first_of_unary(expression, &operator, place),
            ExprData::EBinary(operator) => self.first_of_binary(expression, &operator, place),
            _ => First::Unknown,
        }
    }

    fn first_of_call(&self, call: Expr, site: &E::Call) -> First {
        let closer = valid_behind(site.close_paren_loc, call.loc);
        if let ExprData::EIdentifier(_)
        | ExprData::EImportIdentifier(_)
        | ExprData::ERequireCallTarget = site.target.data
        {
            return First::At(site.target.loc);
        }
        if let Some(found) = self.first_of_member(site.target) {
            return found;
        }
        // The divot of the call is the end of the callee.
        self.first_of(site.target, Place::new(Level::Postfix))
            .or_else(|| self.first_of_list(&site.args, closer))
            .or_else(|| First::at(last_mapping(site.target)))
    }

    /// ``new new tag`..` ``: JSC's parser reads the run of `new` and the tag in one go, and takes the name of the tag to
    /// start where the run does. So the divot lies the length of the name behind the first `new`.
    fn find_tag_behind_new(&self, outermost: Expr) -> Option<Loc> {
        let mut expression = outermost;
        let tag = loop {
            expression = match expression.data {
                ExprData::ENew(site) => site.target,
                ExprData::ETemplate(template) => break template.tag?,
                _ => return None,
            };
        };
        let ExprData::EIdentifier(name) = tag.data else {
            return None;
        };
        if self.is_in_register(name.ref_) {
            return None;
        }
        let mut words_passed = self.name_of(name.ref_).len() / b"new ".len();
        expression = outermost;
        while let ExprData::ENew(site) = expression.data {
            if words_passed == 0 {
                return Some(expression.loc);
            }
            words_passed -= 1;
            expression = site.target;
        }
        Some(tag.loc)
    }

    fn first_of_template(&self, template: &E::Template) -> First {
        let parts = || {
            for part in template.parts() {
                match self.first_of(part.value, Place::new(Level::Lowest)) {
                    First::Nothing => {}
                    found => return found,
                }
            }
            First::Nothing
        };
        let Some(tag) = template.tag else {
            return parts();
        };
        let callee = match tag.data {
            ExprData::EIdentifier(name) if self.is_in_register(name.ref_) => First::Nothing,
            // Reading the member is not recorded.
            ExprData::EDot(_) | ExprData::EIndex(_) => self
                .first_of_object_and_key(tag)
                .map_or(First::Unknown, |found| found.0),
            _ => self.first_of(tag, Place::new(Level::Postfix)),
        };
        // The divot of the call is the end of the tag.
        callee
            .or_else(parts)
            .or_else(|| First::at(last_mapping(tag)))
    }

    fn first_of_unary(&self, expression: Expr, operator: &E::Unary, place: Place) -> First {
        let is_wrapped = place.level.gte(TABLE.get_ptr_const(operator.op).level);
        let follower = place.follower.filter(|_| !is_wrapped);
        let run = place.prefix_run.unwrap_or(expression.loc);
        let operand = Place {
            follower,
            prefix_run: Some(run),
            ..Place::new(Level::Prefix.sub(1))
        };
        let value = operator.value;
        match operator.op {
            OpCode::UnTypeof => match value.data {
                // The divot is the start of the name.
                ExprData::EIdentifier(_) | ExprData::EImportIdentifier(_) => First::At(value.loc),
                _ => self.first_of(value, operand),
            },
            OpCode::UnVoid => self.first_of(value, operand.ignoring_result()),
            OpCode::UnNot if place.is_result_ignored => self.first_of(value, operand),
            OpCode::UnNot if place.is_condition => self.first_of(
                value,
                Place {
                    is_condition: true,
                    ..operand
                },
            ),
            OpCode::UnNeg if is_big_int_literal(value) => First::Nothing,
            OpCode::UnNot | OpCode::UnNeg | OpCode::UnPos | OpCode::UnCpl => {
                self.first_of(value, operand).or_else(|| First::At(run))
            }
            // `delete a`, which only sloppy code has: the answer is false, and nothing is looked for. `delete (0, a)` is printed for any other.
            OpCode::UnDelete
                if operator.flags.contains(
                    E::UnaryFlags::WAS_ORIGINALLY_DELETE_OF_IDENTIFIER_OR_PROPERTY_ACCESS,
                ) && matches!(value.data, ExprData::EIdentifier(name) if self.is_in_register(name.ref_)) =>
            {
                First::Nothing
            }
            // The divot is the end of the member. What is no member is evaluated, and its value is dropped.
            OpCode::UnDelete => match self.first_of_object_and_key(value) {
                Some((found, _)) => found.or_else(|| First::at(last_mapping(value))),
                None => self.first_of(value, operand.ignoring_result()),
            },
            OpCode::UnPreDec | OpCode::UnPreInc | OpCode::UnPostDec | OpCode::UnPostInc => {
                match value.data {
                    ExprData::EIdentifier(name) if self.is_in_register(name.ref_) => {
                        let is_prefix = OpCode::is_prefix(operator.op);
                        if is_prefix || place.is_result_ignored {
                            First::Nothing
                        } else {
                            First::At(value.loc)
                        }
                    }
                    ExprData::EIdentifier(_) | ExprData::EImportIdentifier(_) => {
                        First::At(value.loc)
                    }
                    _ => self.first_of_member(value).unwrap_or(First::Unknown),
                }
            }
            _ => First::Unknown,
        }
    }

    fn first_of_binary(&self, expression: Expr, operator: &E::Binary, place: Place) -> First {
        let level = TABLE.get_ptr_const(operator.op).level;
        let is_wrapped = place.level.gte(level);
        let follower = place.follower.filter(|_| !is_wrapped);
        let (mut left_level, mut right_level) = (level.sub(1), level.sub(1));
        if OpCode::is_right_associative(operator.op) {
            left_level = level;
        }
        if OpCode::is_left_associative(operator.op) {
            right_level = level;
        }
        let (left, right) = (operator.left, operator.right);
        let left_place = Place::new(left_level);
        let right_place = Place::new(right_level).followed_by(follower);
        match operator.op {
            OpCode::BinComma => self
                .first_of(left, left_place.ignoring_result())
                .or_else(|| {
                    let right_place = Place {
                        is_result_ignored: place.is_result_ignored,
                        ..right_place
                    };
                    self.first_of(right, right_place)
                }),
            OpCode::BinAssign => match left.data {
                ExprData::EIdentifier(name) if self.is_in_register(name.ref_) => {
                    self.first_of(right, right_place)
                }
                ExprData::EIdentifier(_) | ExprData::EImportIdentifier(_) => First::At(left.loc),
                ExprData::EDot(_) | ExprData::EIndex(_) => {
                    match self.first_of_object_and_key(left) {
                        Some((found, object)) => found
                            .or_else(|| self.first_of(right, right_place))
                            .or_else(|| First::at(last_mapping(object))),
                        None => First::Unknown,
                    }
                }
                ExprData::EArray(_) | ExprData::EObject(_) => self
                    .first_of(right, right_place)
                    .or_else(|| self.first_of_target(left, None)),
                _ => First::Unknown,
            },
            operation if operation.binary_assign_target() != AssignTarget::None => {
                match left.data {
                    ExprData::EIdentifier(name) if self.is_in_register(name.ref_) => {
                        self.first_of(right, right_place)
                    }
                    ExprData::EIdentifier(_) | ExprData::EImportIdentifier(_) => {
                        First::At(left.loc)
                    }
                    _ => self.first_of_member(left).unwrap_or(First::Unknown),
                }
            }
            _ => {
                let inherited = place.binary_run.filter(|_| !is_wrapped);
                let run = inherited.unwrap_or_else(|| first_mapping(expression));
                let is_logical =
                    matches!(operator.op, OpCode::BinLogicalOr | OpCode::BinLogicalAnd);
                let is_condition = place.is_condition && is_logical;
                let in_run = |place: Place| Place {
                    binary_run: Some(run),
                    is_condition,
                    ..place
                };
                self.first_of_operator(operator, in_run(left_place), in_run(right_place), run)
            }
        }
    }

    /// `run`: the mapping at the start of the run of operators.
    fn first_of_operator(
        &self,
        operator: &E::Binary,
        left_place: Place,
        right_place: Place,
        run: Option<Loc>,
    ) -> First {
        let (left, right) = (operator.left, operator.right);
        let operands = || {
            self.first_of(left, left_place)
                .or_else(|| self.first_of(right, right_place))
        };
        let is_null = |operand: Expr| matches!(operand.data, ExprData::ENull(_));
        match operator.op {
            OpCode::BinLogicalOr
            | OpCode::BinLogicalAnd
            | OpCode::BinNullishCoalescing
            | OpCode::BinLooseEq
            | OpCode::BinStrictEq => operands(),
            OpCode::BinLooseNe if is_null(left) || is_null(right) => operands(),
            // Three strings or more are joined at once, and that is recorded first.
            OpCode::BinAdd
                if matches!(left.data, ExprData::EBinary(inner) if inner.op == OpCode::BinAdd)
                    && is_string(left) =>
            {
                First::at(run)
            }
            OpCode::BinIn if matches!(left.data, ExprData::EPrivateIdentifier(_)) => operands(),
            // The divot is the start of the right operand.
            OpCode::BinIn | OpCode::BinInstanceof => {
                operands().or_else(|| First::at(first_mapping(right)))
            }
            _ => operands().or_else(|| First::at(run)),
        }
    }
}
