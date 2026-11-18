//! From a tree to what the driver compiles. No name that the page has chosen is left, nothing is read before it is written, and no index is out of range.

use std::collections::HashMap;
use std::fmt::Write;

use super::lexer::Known;
use super::tree::*;
use super::{EXTENSIONS, Stage};

pub const MAX_LENGTH: usize = 1 << 25;
pub const DRAW_ID: &str = "d";

/// What makes a loop end. One that does not can have undefined behavior.
const ENDS: [&str; 3] = ["uint c=0u", "&&", "(c+=256u)!=0u"];

/// How a variable of the interface is connected.
#[derive(Clone, Default)]
pub struct Connection {
    pub name: String,
    pub location: Option<u32>,
    pub is_invariant: bool,
    pub sampling: Sampling,
}

pub struct Interface {
    /// For each variable. An output of the vertex shader that has none goes nowhere.
    pub connections: Vec<Option<Connection>>,
    /// For each struct, the same number as for those with the same members, in both stages.
    pub structs: Vec<u32>,
    /// That `gl_FragColor` or `gl_FragData` is written to.
    pub colors: u32,
}

impl Interface {
    pub fn new(shader: &Shader, structs: &mut HashMap<Vec<Type>, u32>) -> Interface {
        let mut numbers = vec![0];
        for it in &shader.structs[1..] {
            let renumber = |of: Type| {
                if let Base::Struct(it) = of.base {
                    Type {
                        base: Base::Struct(numbers[it as usize]),
                        ..of
                    }
                } else {
                    of
                }
            };
            let next = structs.len() as u32 + 1;
            numbers.push(
                *structs
                    .entry(it.fields.iter().map(|it| renumber(it.of)).collect())
                    .or_insert(next),
            );
        }
        Interface {
            connections: vec![None; shader.variables.len()],
            structs: numbers,
            colors: 1,
        }
    }
}

struct Printer<'a> {
    shader: &'a Shader,
    interface: &'a Interface,
    out: String,
    /// Indices of arrays of samplers, and what they stand for in this branch.
    fixed: Vec<(Id, u32)>,
    /// Functions that stand in for operators.
    helpers: Vec<String>,
    /// The function returns a number instead of nothing.
    is_padded: bool,
}

macro_rules! put {
    ($printer:expr, $($argument:tt)*) => { _ = write!($printer.out, $($argument)*) };
}

/// For a shader that is not part of a program.
pub fn translate(shader: &Shader) -> String {
    print(shader, &Interface::new(shader, &mut HashMap::new())).unwrap_or_default()
}

/// `None` if it gets too long.
pub fn print(shader: &Shader, interface: &Interface) -> Option<String> {
    let mut it = Printer {
        shader,
        interface,
        out: String::with_capacity(shader.expressions.len() * 8),
        fixed: Vec::new(),
        helpers: Vec::new(),
        is_padded: false,
    };
    it.header();
    it.globals();
    let start = it.out.len();
    shader
        .order
        .iter()
        .for_each(|function| it.function(*function));
    it.main();
    it.out.insert_str(start, &it.helpers.concat());
    (it.out.len() < MAX_LENGTH).then_some(it.out)
}

pub fn field_name(structure: Type, index: u32) -> String {
    if structure.base == Base::Struct(0) {
        ["near", "far", "diff"][index as usize].into()
    } else {
        format!("m{index}")
    }
}

impl<'a> Printer<'a> {
    fn put(&mut self, text: &str) {
        self.out.push_str(text);
    }

    fn at(&self, id: Id) -> &'a Expression {
        &self.shader.expressions[id as usize]
    }

    fn element_type(&mut self, of: Type) {
        match of.base {
            Base::Struct(0) => self.put("gl_DepthRangeParameters"),
            Base::Struct(it) => put!(self, "S{}", self.interface.structs[it as usize]),
            _ => self.put(of.keyword()),
        }
    }

    fn size(&mut self, of: Type) {
        if of.is_array() {
            put!(self, "[{}]", of.length);
        }
    }

    fn whole_type(&mut self, of: Type) {
        self.element_type(of);
        self.size(of);
    }

    fn name(&self, variable: u32) -> String {
        let it = &self.shader.variables[variable as usize];
        match (&*it.name, &self.interface.connections[variable as usize]) {
            ("gl_DrawID", _) => DRAW_ID.into(),
            ("gl_FragDepthEXT", _) => "gl_FragDepth".into(),
            (name, _) if it.is_builtin && !self.is_color(it) => name.into(),
            (_, Some(connection)) if it.storage == Storage::Block => {
                format!("{}i", connection.name)
            }
            (_, Some(connection)) => connection.name.clone(),
            _ => format!("v{variable}"),
        }
    }

    /// It is an ordinary variable, which is copied in the end.
    fn is_color(&self, it: &Variable) -> bool {
        it.is_builtin
            && matches!(
                &*it.name,
                "gl_FragColor"
                    | "gl_FragData"
                    | "gl_SecondaryFragColorEXT"
                    | "gl_SecondaryFragDataEXT"
            )
    }

    /// Likewise, so that all components of the color are written.
    fn is_narrow(&self, it: &Variable) -> bool {
        it.storage == Storage::Output && it.of.rows < 4 && self.shader.stage == Stage::Fragment
    }

    fn declare(&mut self, of: Type, name: &str) {
        self.element_type(of);
        put!(self, " {name}");
        self.size(of);
    }

    fn scalar(&mut self, scalar: Scalar, bits: u32) {
        match (scalar, f32::from_bits(bits)) {
            (Scalar::Float, value) if !value.is_finite() => put!(self, "uintBitsToFloat({bits}u)"),
            (Scalar::Float, value) if value.is_sign_negative() => put!(self, "({value:?})"),
            (Scalar::Float, value) => put!(self, "{value:?}"),
            (Scalar::Int, _) if bits == 1 << 31 => put!(self, "int({bits}u)"),
            (Scalar::Int, _) if bits > 1 << 31 => put!(self, "({})", bits as i32),
            (Scalar::Int, _) => put!(self, "{bits}"),
            (Scalar::Uint, _) => put!(self, "{bits}u"),
            (Scalar::Bool, _) => put!(self, "{}", bits != 0),
        }
    }

    fn list<T>(&mut self, items: impl IntoIterator<Item = T>, mut print: impl FnMut(&mut Self, T)) {
        self.put("(");
        for (at, item) in items.into_iter().enumerate() {
            self.put(if at > 0 { "," } else { "" });
            print(self, item);
        }
        self.put(")");
    }

    /// Zero if there are no values.
    fn literal(&mut self, of: Type, values: Option<&[u32]>) {
        let part = |start: u32, of: Type| {
            values.map(|it| &it[start as usize..][..self.shader.scalars(of) as usize])
        };
        if let (Some(scalar), true) = (of.scalar(), of.is_scalar()) {
            return self.scalar(scalar, values.map_or(0, |it| it[0]));
        }
        self.whole_type(of);
        if let Some(scalar) = of.scalar() {
            let values = values.unwrap_or(&[0]);
            let is_uniform = !of.is_matrix() && values.iter().all(|it| *it == values[0]);
            self.list(
                if is_uniform { &values[..1] } else { values },
                |it, bits| it.scalar(scalar, *bits),
            );
        } else if of.is_array() {
            let (element, scalars) = (of.element(), self.shader.scalars(of.element()));
            self.list(0..of.length, |it, at| {
                it.literal(element, part(at * scalars, element))
            });
        } else {
            self.list(
                self.shader.structure(of).iter().flat_map(|it| &it.fields),
                |it, field| it.literal(field.of, part(field.offset, field.of)),
            );
        }
    }

    fn values(&self, values: Option<Values>) -> Option<&'a [u32]> {
        values.map(|it| &self.shader.values[it.range()])
    }

    fn zero(&mut self, target: &str, of: Type, depth: usize) {
        if self.shader.scalars(of) <= 16 {
            put!(self, "{target}=");
            self.literal(of, None);
            self.put(";\n");
        } else if of.is_array() {
            put!(
                self,
                "for(int z{depth}=0;z{depth}<{};z{depth}++){{",
                of.length
            );
            self.zero(&format!("{target}[z{depth}]"), of.element(), depth + 1);
            self.put("}\n");
        } else {
            for (index, field) in
                (0..).zip(self.shader.structure(of).iter().flat_map(|it| &it.fields))
            {
                self.zero(&format!("{target}.m{index}"), field.of, depth);
            }
        }
    }

    /// An index of an array of samplers that is not known yet.
    fn open_index(&self, id: Id) -> Option<(Id, Id, u32)> {
        let it = self.at(id);
        match it.node {
            _ if !self.shader.has_samplers(it.of) => None,
            Node::Index(whole, index)
                if self.at(index).value.is_none() && !self.fixed.iter().any(|it| it.0 == id) =>
            {
                Some((id, index, self.at(whole).of.length))
            }
            Node::Index(whole, _) | Node::Field(whole, _) => self.open_index(whole),
            _ => None,
        }
    }

    fn call(&mut self, id: Id, name: &str, arguments: &[Id]) {
        let Some((open, index, count)) = arguments.iter().find_map(|it| self.open_index(*it))
        else {
            self.put(name);
            return self.list(arguments, |it, argument| it.expression(*argument));
        };
        self.put("(");
        for value in (0..count).rev().take_while(|_| count > 0) {
            if value > 0 {
                self.expression(index);
                put!(self, ">={value}?");
            }
            self.fixed.push((open, value));
            self.expression(id);
            self.fixed.pop();
            self.put(if value > 0 { ":" } else { ")" });
        }
    }

    fn index(&mut self, id: Id, whole: Id, index: Id) {
        let of = self.at(whole).of;
        let last = if of.is_array() {
            of.length
        } else if of.is_matrix() {
            of.columns.into()
        } else {
            of.rows.into()
        } - 1;
        self.expression(whole);
        if let Some(fixed) = self.fixed.iter().find(|it| it.0 == id) {
            return put!(self, "[{}]", fixed.1);
        }
        let (before, after) = match self.at(index) {
            Expression { value: Some(_), .. } => ("[", "]".into()),
            Expression { of: Type::UINT, .. } => ("[min(", format!(",{last}u)]")),
            _ => ("[clamp(", format!(",0,{last})]")),
        };
        self.put(before);
        self.expression(index);
        self.put(&after);
    }

    fn infix(&mut self, parts: &[(Id, &str)]) {
        self.put("(");
        for (id, after) in parts {
            self.expression(*id);
            self.put(after);
        }
        self.put(")");
    }

    fn help(&mut self, helper: String) {
        if !self.helpers.contains(&helper) {
            self.helpers.push(helper);
        }
    }

    fn divide(&mut self, operator: Known, of: Type, left: Id, right: Id) {
        let (name, sign, kind) = (
            if matches!(operator, Known::Slash | Known::DivideAssign) {
                "q"
            } else {
                "w"
            },
            &operator.text()[..1],
            of.keyword(),
        );
        let is = |a: &str, b: &str| {
            if of.is_scalar() {
                format!("int({a}=={b})")
            } else {
                format!("{kind}(equal({a},{kind}({b})))")
            }
        };
        let divisor = if of.scalar() == Some(Scalar::Uint) {
            "max(b,1u)".into()
        } else {
            format!(
                "(b+{}+2*{}*{})",
                is("b", "0"),
                is("b", "-1"),
                is("a", "int(2147483648u)")
            )
        };
        self.help(format!(
            "{kind} {name}({kind} a,{kind} b){{return a{sign}{divisor};}}\n"
        ));
        if operator.text().len() > 1 {
            self.help(format!(
                "{kind} {name}a(inout {kind} a,{kind} b){{return a={name}(a,b);}}\n"
            ));
            self.around(&format!("{name}a("), Some(left), ",");
        } else {
            self.around(&format!("{name}({kind}("), Some(left), "),");
        }
        self.around(&format!("{kind}("), Some(right), "))");
    }

    /// From what has undefined behavior, a compiler could conclude that an index is in range. False if there is no such risk.
    fn define_behavior(&mut self, id: Id) -> bool {
        let it = self.at(id);
        let is_always = |id, test: fn(u32) -> bool| {
            self.values(self.at(id).value)
                .is_some_and(|it| it.iter().all(|it| test(*it)))
        };
        match it.node {
            Node::Binary(
                operator @ (Known::Slash
                | Known::Percent
                | Known::DivideAssign
                | Known::ModuloAssign),
                left,
                right,
            ) if it.of.is_integer() && !is_always(right, |it| it != 0 && it != !0) => {
                self.divide(operator, it.of, left, right);
            }
            Node::Binary(
                operator @ (Known::ShiftLeft
                | Known::ShiftRight
                | Known::ShiftLeftAssign
                | Known::ShiftRightAssign),
                left,
                right,
            ) if !is_always(right, |it| it < 32) => {
                self.infix(&[
                    (left, &format!("{}(", operator.text())),
                    (
                        right,
                        if self.at(right).of.scalar() == Some(Scalar::Uint) {
                            "&31u)"
                        } else {
                            "&31)"
                        },
                    ),
                ]);
            }
            Node::Construct(ref arguments) if it.of.is_integer() => {
                let range = if it.of.scalar() == Some(Scalar::Uint) {
                    ",0.,4294967040.)"
                } else {
                    ",-2147483648.,2147483520.)"
                };
                self.whole_type(it.of);
                self.list(arguments, |it, argument| match it.at(*argument).of {
                    of if of.is_matrix() => {
                        it.around("clamp(vec4(", Some(*argument), &format!("){range}"))
                    }
                    of if of.scalar() == Some(Scalar::Float) => {
                        it.around("clamp(", Some(*argument), range)
                    }
                    _ => it.expression(*argument),
                });
            }
            _ => return false,
        }
        true
    }

    fn expression(&mut self, id: Id) {
        let it = self.at(id);
        if it.value.is_some() && it.of.scalar().is_some() {
            return self.literal(it.of, self.values(it.value));
        }
        if self.out.len() >= MAX_LENGTH || self.define_behavior(id) {
            return;
        }
        match it.node {
            Node::Constant => {}
            Node::Variable(variable) => self.put(&self.name(variable)),
            Node::Prefix(operator, operand) => {
                put!(self, "({}", operator.text());
                self.expression(operand);
                self.put(")");
            }
            Node::Postfix(operator, operand) => self.infix(&[(operand, operator.text())]),
            Node::Binary(operator, left, right) => {
                self.infix(&[(left, operator.text()), (right, "")])
            }
            Node::Conditional(condition, then, otherwise) => {
                self.infix(&[(condition, "?"), (then, ":"), (otherwise, "")])
            }
            Node::Index(whole, index) => self.index(id, whole, index),
            Node::Field(whole, index) => {
                self.expression(whole);
                put!(self, ".{}", field_name(self.at(whole).of, index));
            }
            Node::Swizzle(whole, components) => {
                self.expression(whole);
                self.put(".");
                self.out.extend(
                    components[..it.of.rows.into()]
                        .iter()
                        .map(|it| ['x', 'y', 'z', 'w'][usize::from(*it)]),
                );
            }
            Node::Call(function, ref arguments) => {
                self.call(id, &format!("f{function}"), arguments)
            }
            Node::Builtin(builtin, ref arguments) => {
                self.call(id, builtin.modern_name(), arguments)
            }
            Node::Construct(ref arguments) => {
                self.whole_type(it.of);
                self.list(arguments, |it, argument| it.expression(*argument));
            }
            Node::Length(whole) => {
                self.infix(&[(whole, &format!("[0],{}", self.at(whole).of.length))])
            }
        }
    }

    fn around(&mut self, before: &str, id: Option<Id>, after: &str) {
        self.put(before);
        id.inspect(|it| self.expression(*it));
        self.put(after);
    }

    fn constant(&mut self, variable: u32) {
        let it = &self.shader.variables[variable as usize];
        if it.of.scalar().is_none() {
            self.put("const ");
            self.declare(it.of, &self.name(variable));
            self.put("=");
            self.literal(it.of, self.values(it.value));
            self.put(";\n");
        }
    }

    fn local(&mut self, variable: u32, value: Option<Id>) {
        let (it, name) = (
            &self.shader.variables[variable as usize],
            self.name(variable),
        );
        if it.value.is_some() {
            return self.constant(variable);
        }
        self.declare(it.of, &name);
        if value.is_some() {
            return self.around("=", value, ";\n");
        }
        self.put(";");
        self.zero(&name, it.of, 0);
    }

    fn block(&mut self, statements: &[Statement]) {
        self.put("{");
        statements.iter().for_each(|it| self.statement(it));
        self.put("}\n");
    }

    fn statement(&mut self, statement: &Statement) {
        match *statement {
            Statement::Declare(variable, value) => self.local(variable, value),
            Statement::Evaluate(id) => self.around("", Some(id), ";\n"),
            Statement::Block(ref statements) => self.block(statements),
            Statement::If(condition, ref then, ref otherwise) => {
                self.around("if(", Some(condition), ")");
                self.statement(then);
                if let Some(otherwise) = otherwise {
                    self.put("else");
                    self.statement(otherwise);
                }
            }
            Statement::Loop {
                condition,
                step,
                ref body,
                is_finite,
            } => {
                let [counter, and, test] = if is_finite { [""; 3] } else { ENDS };
                self.around(
                    &format!("for({counter};"),
                    condition,
                    if condition.is_some() { and } else { "" },
                );
                self.around(&format!("{test};"), step, ")");
                self.statement(body);
            }
            Statement::DoWhile(ref body, condition) => {
                let [counter, and, test] = ENDS;
                put!(self, "{{{counter};do");
                self.statement(body);
                self.around("while(", Some(condition), &format!("{and}{test});}}\n"));
            }
            Statement::Switch(selector, ref statements) => self.switch(selector, statements),
            Statement::Case(None) => self.put("default:"),
            Statement::Case(label) => self.around("case ", label, ":"),
            Statement::Jump(keyword) => put!(self, "{};\n", keyword.text()),
            Statement::Return(None) if self.is_padded => self.put("return 0;\n"),
            Statement::Return(value) => self.around("return ", value, ";\n"),
        }
    }

    /// A jump must not skip what makes a variable zero.
    fn switch(&mut self, selector: Id, statements: &[Statement]) {
        self.put("{");
        for it in statements {
            if let Statement::Declare(variable, _) = *it {
                self.local(variable, None);
            }
        }
        self.around("switch(", Some(selector), "){");
        for it in statements {
            match *it {
                Statement::Declare(variable, value @ Some(_))
                    if self.shader.variables[variable as usize].value.is_none() =>
                {
                    self.around(&(self.name(variable) + "="), value, ";\n")
                }
                Statement::Declare(..) => {}
                _ => self.statement(it),
            }
        }
        self.put(if statements.is_empty() {
            "}}\n"
        } else {
            "break;}}\n"
        });
    }

    fn function(&mut self, index: u32) {
        let it = &self.shader.functions[index as usize];
        let (parameters, body) = (
            it.parameters
                .iter()
                .map(|it| (*it, &self.shader.variables[*it as usize])),
            it.body.as_deref().unwrap_or_default(),
        );
        self.is_padded = it.returns == Type::VOID
            && parameters
                .clone()
                .any(|it| self.shader.has_samplers(it.1.of));
        let returns = if self.is_padded {
            Type::INT
        } else {
            it.returns
        };
        self.whole_type(returns);
        put!(self, " f{index}");
        self.list(parameters.clone(), |it, (index, parameter)| {
            it.put(match parameter.storage {
                Storage::Parameter(Direction::Out) => "out ",
                Storage::Parameter(Direction::InOut) => "inout ",
                _ => "",
            });
            it.declare(parameter.of, &it.name(index));
        });
        self.put("{");
        for (index, parameter) in
            parameters.filter(|it| it.1.storage == Storage::Parameter(Direction::Out))
        {
            self.zero(&self.name(index), parameter.of, 0);
        }
        body.iter().for_each(|it| self.statement(it));
        if returns != Type::VOID && !matches!(body.last(), Some(Statement::Return(_))) {
            self.declare(returns, "r");
            self.put(";");
            self.zero("r", returns, 0);
            self.put("return r;");
        }
        self.put("}\n");
    }

    fn header(&mut self) {
        self.put("#version 300 es\n");
        for it in EXTENSIONS
            .iter()
            .filter(|it| it.bit & self.shader.extensions != 0 && !it.native.is_empty())
        {
            put!(self, "#extension {} : enable\n", it.native);
        }
        self.put("precision highp float;precision highp int;");
        for it in TYPES
            .iter()
            .filter(|it| matches!(it.2.base, Base::Sampler(..)) && (it.1 || self.shader.is_es3))
        {
            put!(self, "precision highp {};", it.0);
        }
        self.put("\n");
    }

    fn members(&mut self, structure: &Struct) {
        self.put("{");
        for (index, field) in structure.fields.iter().enumerate() {
            self.put(if field.is_row_major {
                "layout(row_major) "
            } else {
                ""
            });
            self.declare(field.of, &format!("m{index}"));
            self.put(";");
        }
        self.put("}");
    }

    fn builtins(&self) -> impl Iterator<Item = (u32, &'a Variable)> + use<'a> {
        (0..)
            .zip(&self.shader.variables)
            .take_while(|it| it.1.is_builtin)
            .filter(|it| it.1.is_active)
    }

    fn is_output(&self, variable: u32) -> bool {
        self.shader.variables[variable as usize].storage == Storage::Output
            && self.interface.connections[variable as usize].is_some()
    }

    fn globals(&mut self) {
        let (shader, mut last) = (
            self.shader,
            vec![
                false;
                self.interface
                    .structs
                    .iter()
                    .max()
                    .map_or(0, |it| *it as usize + 1)
            ],
        );
        for (it, number) in shader.structs.iter().zip(&self.interface.structs).skip(1) {
            if !it.is_block && !std::mem::replace(&mut last[*number as usize], true) {
                put!(self, "struct S{number}");
                self.members(it);
                self.put(";\n");
            }
        }
        for (index, it) in self.builtins() {
            let name = self.name(index);
            match &*it.name {
                "gl_DrawID" => put!(self, "uniform int {name};\n"),
                "gl_ClipDistance" | "gl_CullDistance" => put!(
                    self,
                    "{} float {name}[{}];\n",
                    if it.storage == Storage::Input {
                        "in"
                    } else {
                        "out"
                    },
                    it.of.length
                ),
                "gl_FragDepth" => {
                    _ = shader
                        .depth_layout
                        .inspect(|it| put!(self, "layout({}) out float gl_FragDepth;\n", it.text()))
                }
                _ if self.is_color(it) => {
                    self.declare(it.of, &name);
                    self.put(";\n");
                    for (location, index) in self.copies(it) {
                        put!(
                            self,
                            "layout(location={location}{}) out vec4 o{location}_{index};\n",
                            if index > 0 { ",index=1" } else { "" }
                        );
                    }
                }
                _ => {}
            }
        }
        for name in ["gl_Position", "gl_PointSize"].into_iter().filter(|it| {
            shader
                .builtin(it)
                .is_some_and(|it| it.is_invariant && it.is_active)
        }) {
            put!(self, "invariant {name};\n");
        }
        for &(index, _) in &shader.globals {
            let (it, connection) = (
                &shader.variables[index as usize],
                self.interface.connections[index as usize].as_ref(),
            );
            match (it.storage, shader.structure(it.of)) {
                _ if !it.is_active && !self.is_output(index) => continue,
                (Storage::Constant, _) => {
                    self.constant(index);
                    continue;
                }
                (Storage::Block, Some(block)) => {
                    put!(
                        self,
                        "layout(std140) uniform {}",
                        connection.map_or_else(|| format!("b{index}"), |it| it.name.clone())
                    );
                    self.members(block);
                    self.put(&self.name(index));
                    self.size(it.of);
                    self.put(";\n");
                    continue;
                }
                (Storage::Uniform, _) => self.put("uniform "),
                _ if self.is_narrow(it) => {
                    for element in 0..it.of.count() {
                        self.qualifiers(
                            it,
                            &Connection {
                                location: connection.and_then(|it| Some(it.location? + element)),
                                ..Connection::default()
                            },
                        );
                        self.declare(
                            Type {
                                rows: 4,
                                ..it.of.element()
                            },
                            &format!("w{index}_{element};"),
                        );
                    }
                }
                (Storage::Input | Storage::Output, _)
                    if it.storage == Storage::Input || connection.is_some() =>
                {
                    self.qualifiers(it, &connection.cloned().unwrap_or_default())
                }
                _ => {}
            }
            self.declare(it.of, &self.name(index));
            self.put(";\n");
        }
    }

    fn qualifiers(&mut self, it: &Variable, connection: &Connection) {
        if let Some(location) = connection.location {
            put!(
                self,
                "layout(location={location}{}) ",
                if it.index == Some(1) { ",index=1" } else { "" }
            );
        }
        self.put(if connection.is_invariant {
            "invariant "
        } else {
            ""
        });
        self.put(["", "flat ", "noperspective "][it.interpolation as usize]);
        self.put(["", "centroid ", "sample "][connection.sampling as usize]);
        self.put(if it.storage == Storage::Input {
            "in "
        } else {
            "out "
        });
    }

    /// Location and index.
    fn copies(&self, color: &Variable) -> impl Iterator<Item = (u32, u32)> + use<> {
        let index = u32::from(color.name.starts_with("gl_Secondary"));
        (0..if index > 0 {
            color.of.count()
        } else {
            self.interface.colors
        })
            .map(move |it| (it, index))
    }

    fn main(&mut self) {
        let shader = self.shader;
        self.put("void main(){");
        if shader.stage == Stage::Vertex {
            self.put("gl_Position=vec4(0.0);\n");
        }
        for (index, it) in self
            .builtins()
            .filter(|it| it.1.storage == Storage::Output && *it.1.name != *"gl_Position")
        {
            match &*self.name(index) {
                "gl_FragDepth" => self.put("gl_FragDepth=gl_FragCoord.z;\n"),
                "gl_SampleMask" => put!(
                    self,
                    "for(int z=0;z<{};z++)gl_SampleMask[z]=-1;\n",
                    it.of.length
                ),
                name if it.of.is_array() => (0..it.of.length)
                    .for_each(|at| self.zero(&format!("{name}[{at}]"), it.of.element(), 0)),
                name => self.zero(name, it.of, 0),
            }
        }
        for &(index, value) in &shader.globals {
            let (it, name) = (&shader.variables[index as usize], self.name(index));
            match it.storage {
                _ if !it.is_active && !self.is_output(index) => {}
                Storage::Global if value.is_some() => self.around(&(name + "="), value, ";\n"),
                Storage::Output if it.of.is_array() && shader.stage == Stage::Fragment => {
                    (0..it.of.length)
                        .for_each(|at| self.zero(&format!("{name}[{at}]"), it.of.element(), 0))
                }
                Storage::Global | Storage::Output => self.zero(&name, it.of, 0),
                _ => {}
            }
        }
        put!(self, "f{}();\n", shader.order.last().unwrap_or(&0));
        for (variable, it) in self
            .builtins()
            .filter(|it| self.is_color(it.1))
            .collect::<Vec<_>>()
        {
            for (location, index) in self.copies(it) {
                put!(self, "o{location}_{index}=v{variable}");
                put!(
                    self,
                    "{};\n",
                    if it.of.is_array() {
                        format!("[{location}]")
                    } else {
                        String::new()
                    }
                );
            }
        }
        for (index, it) in shader
            .declared(Storage::Output)
            .filter(|it| it.1.is_active && self.is_narrow(it.1))
            .collect::<Vec<_>>()
        {
            let (kind, name, rest) = (
                Type {
                    rows: 4,
                    ..it.of.element()
                }
                .keyword(),
                self.name(index),
                [",0,0,1", ",0,1", ",1"][usize::from(it.of.rows) - 1],
            );
            for element in 0..it.of.count() {
                put!(
                    self,
                    "w{index}_{element}={kind}({name}{}{rest});\n",
                    if it.of.is_array() {
                        format!("[{element}]")
                    } else {
                        String::new()
                    }
                );
            }
        }
        self.put("}\n");
    }
}
