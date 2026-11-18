//! From tokens to a tree: declarations.

use super::builtins;
use super::lexer::{Known, Token};
use super::parser::{Parser, Symbol, Word};
use super::tree::*;
use super::{
    CONSERVATIVE_DEPTH, DUAL_SOURCE, INTERPOLATION, MAX_DEPTH, NOPERSPECTIVE, Result, Stage,
};

const MAX_LENGTH: u32 = 1 << 16;
const MAX_NESTING: u8 = 4;
const MAX_SCALARS: u32 = 1 << 20;
const MAX_PRIVATE_SCALARS: u32 = 1 << 14;
const MAX_TOTAL_PRIVATE_SCALARS: u32 = 1 << 18;

#[derive(Clone, Copy, Default)]
struct Layout {
    location: Option<u32>,
    index: Option<u32>,
    is_row_major: Option<bool>,
    is_std140: bool,
    depth: Option<Known>,
}

#[derive(Clone, Copy, Default)]
struct Qualifiers {
    is_invariant: bool,
    layout: Option<Layout>,
    interpolation: Option<Interpolation>,
    sampling: Sampling,
    storage: Option<Known>,
    precision: Precision,
}

impl Qualifiers {
    fn is_for_interface(&self) -> bool {
        self.is_invariant || self.interpolation.is_some() || self.sampling != Sampling::Center
    }
}

impl Parser<'_> {
    fn precision(&mut self) -> Precision {
        let known = [
            (Known::Lowp, Precision::Low),
            (Known::Mediump, Precision::Medium),
            (Known::Highp, Precision::High),
        ];
        known
            .into_iter()
            .find(|it| self.eat(it.0))
            .map_or(Precision::None, |it| it.1)
    }

    fn layout(&mut self) -> Result<Layout> {
        self.expect(Known::LeftParen)?;
        let mut layout = Layout::default();
        loop {
            let name = self.identifier()?;
            match name.known() {
                known @ (Known::Location | Known::Index)
                    if known == Known::Location || self.has(DUAL_SOURCE) =>
                {
                    self.expect(Known::Assign)?;
                    let number = self.advance();
                    let value = super::lexer::integer(self.text(number))
                        .filter(|it| it.0 < if known == Known::Index { 2 } else { MAX_LENGTH });
                    let Some((value, _)) = value else {
                        return self.fail_at(number, "out of range");
                    };
                    *if known == Known::Index {
                        &mut layout.index
                    } else {
                        &mut layout.location
                    } = Some(value);
                }
                Known::Std140 => layout.is_std140 = true,
                known @ (Known::RowMajor | Known::ColumnMajor) => {
                    layout.is_row_major = Some(known == Known::RowMajor)
                }
                known @ (Known::DepthAny | Known::DepthGreater | Known::DepthLess)
                    if self.has(CONSERVATIVE_DEPTH) =>
                {
                    layout.depth = Some(known)
                }
                _ => return self.fail_at(name, "this layout is not for it"),
            }
            if !self.eat(Known::Comma) {
                return self.expect(Known::RightParen).map(|()| layout);
            }
        }
    }

    fn qualifiers(&mut self) -> Result<Qualifiers> {
        let mut it = Qualifiers {
            is_invariant: self.eat(Known::Invariant),
            ..Qualifiers::default()
        };
        if self.eat(Known::Layout) {
            it.layout = Some(self.layout()?);
        }
        if self.shader.is_es3 {
            let known = [
                (Known::Smooth, Interpolation::Smooth),
                (Known::Flat, Interpolation::Flat),
                (Known::Noperspective, Interpolation::Linear),
            ];
            it.interpolation = known[..2 + usize::from(self.has(NOPERSPECTIVE))]
                .iter()
                .find(|it| self.eat(it.0))
                .map(|it| it.1);
            let known = [
                (Known::Centroid, Sampling::Centroid),
                (Known::Sample, Sampling::Sample),
            ];
            it.sampling = known[..1 + usize::from(self.has(INTERPOLATION))]
                .iter()
                .find(|it| self.eat(it.0))
                .map_or(Sampling::Center, |it| it.1);
        }
        let of_version = if self.shader.is_es3 {
            [Known::In, Known::Out]
        } else {
            [Known::Attribute, Known::Varying]
        };
        it.storage = [Known::Const, Known::Uniform]
            .into_iter()
            .chain(of_version)
            .find(|it| self.eat(*it));
        it.precision = self.precision();
        Ok(it)
    }

    fn array_size(&mut self, of: Type) -> Result<Type> {
        let at = self.peek();
        if !self.eat(Known::LeftBracket) {
            return Ok(of);
        }
        self.require(
            !of.is_array() && of != Type::VOID,
            at,
            "there are no arrays of it",
        )?;
        if self.shader.is_es3 && self.eat(Known::RightBracket) {
            return Ok(of.array(UNSIZED));
        }
        let size = self.nested(Self::conditional)?;
        let Some(length) = self
            .integer_value(size)
            .filter(|it| (1..=MAX_LENGTH).contains(it))
        else {
            return self.fail_at(at, "the length has to be a constant from 1 to 65536");
        };
        self.expect(Known::RightBracket)?;
        self.require(
            self.next() != Known::LeftBracket,
            at,
            "arrays have one dimension",
        )?;
        Ok(of.array(length))
    }

    pub fn require_size(&mut self, of: Type, storage: Storage, at: Token) -> Result<()> {
        let (scalars, is_private) = (
            self.shader.scalars(of),
            !matches!(storage, Storage::Uniform | Storage::Block),
        );
        self.private_scalars += if is_private {
            scalars.min(MAX_SCALARS)
        } else {
            0
        };
        let fits = scalars
            <= if is_private {
                MAX_PRIVATE_SCALARS
            } else {
                MAX_SCALARS
            }
            && self.private_scalars <= MAX_TOTAL_PRIVATE_SCALARS;
        self.require(
            of.length != UNSIZED,
            at,
            "the array has neither a length nor an initializer",
        )?;
        self.require(fits, at, "it takes too much memory")
    }

    /// And whether it defines a struct.
    pub fn type_specifier(&mut self) -> Result<(Type, bool)> {
        let token = self.peek();
        let (of, defines) = match (self.word(token), self.find(token)) {
            (Word::Keyword, _) if token.is(Known::Struct) => (self.structure()?, true),
            (Word::Type(of), _) => (of, false),
            (_, Some(Symbol::Struct(it))) => (Type::of(Base::Struct(it)), false),
            _ => return self.fail("syntax error"),
        };
        if !defines {
            self.advance();
        }
        let has_size = self.next() == Known::LeftBracket;
        self.require(
            self.shader.is_es3 || !has_size,
            token,
            "array types need version 300",
        )?;
        Ok((self.array_size(of)?, defines))
    }

    fn structure(&mut self) -> Result<Type> {
        self.advance();
        let name = if self.next() == Known::LeftBrace {
            None
        } else {
            Some(self.identifier()?)
        };
        let (index, _) = self.members(name.map_or("", |it| self.text(it)), None)?;
        name.map_or(Ok(()), |it| self.bind(it, Symbol::Struct(index)))?;
        Ok(Type::of(Base::Struct(index)))
    }

    /// Of a struct, or of a block whose matrices are laid out so.
    fn members(&mut self, name: &str, is_row_major: Option<bool>) -> Result<(u32, Vec<Token>)> {
        let (start, index, mut fields, mut names) = (
            self.peek(),
            self.shader.structs.len() as u32,
            Vec::new(),
            Vec::new(),
        );
        self.expect(Known::LeftBrace)?;
        while fields.is_empty() || !self.eat(Known::RightBrace) {
            let (at, qualifiers) = (self.peek(), self.qualifiers()?);
            let layout = qualifiers.layout.unwrap_or_default();
            let is_valid = match is_row_major {
                Some(_) => {
                    matches!(qualifiers.storage, None | Some(Known::Uniform))
                        && layout.location.or(layout.index).is_none()
                        && !layout.is_std140
                        && layout.depth.is_none()
                }
                None => qualifiers.storage.is_none() && qualifiers.layout.is_none(),
            };
            self.require(
                is_valid && !qualifiers.is_for_interface(),
                at,
                "a member cannot be qualified like that",
            )?;
            self.require(
                self.next() != Known::Struct,
                at,
                "a struct cannot be defined in another one",
            )?;
            let of = self.type_specifier()?.0;
            let precision = self.precision_for(of, qualifiers.precision, at)?;
            self.require(
                of != Type::VOID && !(is_row_major.is_some() && self.shader.has_samplers(of)),
                at,
                "a member cannot have this type",
            )?;
            loop {
                let field = self.identifier()?;
                let of = self.array_size(of)?;
                self.require_unreserved(field)?;
                self.require_size(of, Storage::Uniform, field)?;
                let before = self.fields.insert((index, field.name), fields.len() as u32);
                self.require(before.is_none(), field, "there is a member with that name")?;
                let is_row_major = layout.is_row_major.or(is_row_major) == Some(true);
                fields.push(Field {
                    name: self.text(field).into(),
                    of,
                    precision,
                    is_row_major,
                    offset: 0,
                });
                names.push(field);
                if !self.eat(Known::Comma) {
                    break;
                }
            }
            self.expect(Known::Semicolon)?;
        }
        let structure = Struct {
            is_block: is_row_major.is_some(),
            ..self.shader.describe(name, fields)
        };
        self.require(
            structure.depth <= MAX_NESTING + u8::from(structure.is_block),
            start,
            "structs go 4 levels deep at most",
        )?;
        self.shader.structs.push(structure);
        Ok((index, names))
    }

    fn uniform_block(&mut self, qualifiers: Qualifiers) -> Result<()> {
        let (name, layout) = (self.identifier()?, qualifiers.layout.unwrap_or_default());
        let is_plain = layout.location.or(layout.index).is_none()
            && layout.depth.is_none()
            && !qualifiers.is_for_interface()
            && qualifiers.precision == Precision::None;
        self.require(
            qualifiers.storage == Some(Known::Uniform) && is_plain && self.function.is_none(),
            name,
            "only uniforms of version 300 can be in a block",
        )?;
        self.bind(name, Symbol::Block)?;
        let (index, members) = self.members(
            self.text(name),
            Some(layout.is_row_major.unwrap_or(self.is_row_major)),
        )?;
        let instance = if self.next() == Known::Semicolon {
            None
        } else {
            Some(self.identifier()?)
        };
        let of = self.array_size(Type::of(Base::Struct(index)))?;
        self.require_size(of, Storage::Block, name)?;
        let variable = self.add_variable(Variable::new(
            instance.map_or("", |it| self.text(it)),
            of,
            Storage::Block,
            Precision::None,
        ));
        self.shader.globals.push((variable, None));
        match instance {
            Some(it) => self.bind(it, Symbol::Variable(variable))?,
            None => (0..)
                .zip(members)
                .try_for_each(|(at, it)| self.bind(it, Symbol::Member(variable, at)))?,
        }
        self.expect(Known::Semicolon)
    }

    fn make_invariant(&mut self) -> Result<()> {
        loop {
            let name = self.identifier()?;
            let Some(Symbol::Variable(index)) = self.find(name) else {
                return self.fail_at(name, "there is no such variable");
            };
            let it = &self.shader.variables[index as usize];
            self.require(
                self.function.is_none()
                    && self.can_be_invariant(it.storage)
                    && *it.name != *"gl_FrontFacing",
                name,
                "it cannot be invariant",
            )?;
            self.shader.variables[index as usize].is_invariant = true;
            if !self.eat(Known::Comma) {
                return self.expect(Known::Semicolon);
            }
        }
    }

    fn can_be_invariant(&self, storage: Storage) -> bool {
        storage == Storage::Output
            || storage == Storage::Input
                && self.shader.stage == Stage::Fragment
                && !self.shader.is_es3
    }

    /// Those of local variables go to `out`.
    pub fn declaration(&mut self, out: &mut Vec<Statement>) -> Result<()> {
        let start = self.peek();
        if self.eat(Known::Precision) {
            let (precision, of) = (self.precision(), self.type_specifier()?.0);
            self.require(precision != Precision::None, start, "syntax error")?;
            self.set_default_precision(of, precision, start)?;
            return self.expect(Known::Semicolon);
        }
        let qualifiers = self.qualifiers()?;
        if let (Some(layout), Known::Semicolon) = (qualifiers.layout, self.next()) {
            let is_plain = layout.location.or(layout.index).is_none()
                && layout.depth.is_none()
                && !qualifiers.is_for_interface()
                && qualifiers.precision == Precision::None;
            self.require(
                qualifiers.storage == Some(Known::Uniform) && is_plain && self.function.is_none(),
                start,
                "this layout is not for it",
            )?;
            self.is_row_major = layout.is_row_major.unwrap_or(self.is_row_major);
            return self.expect(Known::Semicolon);
        }
        if let Word::Free = self.word(self.peek()) {
            if self.shader.is_es3 && self.is_followed_by(Known::LeftBrace) {
                return self.uniform_block(qualifiers);
            }
            if start.is(Known::Invariant)
                && (self.is_followed_by(Known::Semicolon) || self.is_followed_by(Known::Comma))
                && qualifiers.storage.is_none()
            {
                return self.make_invariant();
            }
        }
        let (at, (of, defines)) = (self.peek(), self.type_specifier()?);
        let precision = self.precision_for(of, qualifiers.precision, at)?;
        if self.is_followed_by(Known::LeftParen) {
            let is_plain = qualifiers.storage.is_none()
                && qualifiers.layout.is_none()
                && !qualifiers.is_for_interface();
            self.require(is_plain, start, "a result only has a precision")?;
            self.require(
                self.can_be_copied(of) && !(defines && self.shader.is_es3) || of == Type::VOID,
                at,
                "a result cannot have this type",
            )?;
            return self.function(of, precision);
        }
        let storage = self.storage(&qualifiers, of, start)?;
        if matches!(self.next(), Known::Semicolon | Known::Comma) {
            self.require(of.length != UNSIZED, at, "the array has no length")?;
        } else {
            self.declarator(&qualifiers, storage, of, precision, out)?;
        }
        while self.eat(Known::Comma) {
            self.declarator(&qualifiers, storage, of, precision, out)?;
        }
        self.expect(Known::Semicolon)
    }

    /// The declaration that is the condition of a loop.
    pub fn initialized(&mut self) -> Result<(u32, Id)> {
        let (at, qualifiers, of, mut out) = (
            self.peek(),
            self.qualifiers()?,
            self.type_specifier()?.0,
            Vec::new(),
        );
        let storage = self.storage(&qualifiers, of, at)?;
        self.declarator(
            &qualifiers,
            storage,
            of,
            self.precision_for(of, qualifiers.precision, at)?,
            &mut out,
        )?;
        if let [Statement::Declare(variable, Some(value))] = out[..] {
            Ok((variable, value))
        } else {
            self.fail("syntax error")
        }
    }

    fn storage(&self, qualifiers: &Qualifiers, of: Type, at: Token) -> Result<Storage> {
        let is_vertex = self.shader.stage == Stage::Vertex;
        let storage = match qualifiers.storage {
            None if self.function.is_some() => Storage::Local,
            None => Storage::Global,
            Some(Known::Const) => Storage::Constant,
            Some(_) if self.function.is_some() => {
                return self.fail_at(at, "not inside of a function");
            }
            Some(Known::Uniform) => Storage::Uniform,
            Some(Known::Attribute) if !is_vertex => {
                return self.fail_at(at, "only a vertex shader has attributes");
            }
            Some(Known::Varying) if is_vertex => Storage::Output,
            Some(Known::Out) => Storage::Output,
            Some(_) => Storage::Input,
        };
        let is_end = storage
            == if is_vertex {
                Storage::Input
            } else {
                Storage::Output
            };
        let is_varying = storage
            == if is_vertex {
                Storage::Output
            } else {
                Storage::Input
            };
        let (layout, structure) = (
            qualifiers.layout.unwrap_or_default(),
            self.shader.structure(of),
        );
        let is_for_color = layout.index.is_some() || layout.depth.is_some();
        let has_valid_layout = (is_end || qualifiers.layout.is_none())
            && !layout.is_std140
            && layout.is_row_major.is_none()
            && !(is_for_color && is_vertex);
        self.require(has_valid_layout, at, "this layout is not for it")?;
        self.require(
            is_varying
                || qualifiers.interpolation.is_none() && qualifiers.sampling == Sampling::Center,
            at,
            "it is not interpolated, or not like that",
        )?;
        self.require(
            !qualifiers.is_invariant || self.can_be_invariant(storage),
            at,
            "it cannot be invariant",
        )?;
        self.require(
            storage == Storage::Uniform
                || !self.shader.has_samplers(of)
                || self.next() == Known::Semicolon,
            at,
            "only uniforms and parameters can be samplers",
        )?;
        let is_valid = match () {
            () if !is_end && !is_varying => true,
            () if !self.shader.is_es3 => of.base == Base::Number(Scalar::Float),
            () if self.shader.has_booleans(of) => false,
            () if is_end => structure.is_none() && (is_vertex || !of.is_matrix()),
            () => {
                structure.is_none_or(|it| it.depth == 1 && !it.has_arrays)
                    && (qualifiers.interpolation == Some(Interpolation::Flat)
                        || !self.shader.has_integers(of))
            }
        };
        self.require(is_valid, at, "the qualifier does not go with the type")
            .map(|()| storage)
    }

    fn redeclare(
        &mut self,
        name: Token,
        qualifiers: &Qualifiers,
        storage: Storage,
        of: Type,
    ) -> Result<()> {
        let Some(Symbol::Variable(index)) = self.find(name) else {
            return self.require_unreserved(name);
        };
        let (it, depth) = (
            &self.shader.variables[index as usize],
            qualifiers.layout.and_then(|it| it.depth),
        );
        let is_valid = match self.text(name) {
            "gl_FragDepth" => {
                self.has(CONSERVATIVE_DEPTH)
                    && of == it.of
                    && !it.is_used
                    && self.shader.depth_layout.is_none()
            }
            name => {
                it.of.length == UNSIZED
                    && of.element() == Type::FLOAT
                    && (it.reach.max(1)
                        ..=self.limits.distances[usize::from(name == "gl_CullDistance")])
                        .contains(&of.length)
            }
        };
        self.require(
            is_valid
                && storage == it.storage
                && qualifiers
                    .layout
                    .is_none_or(|it| it.location.or(it.index).is_none()),
            name,
            "the prefix is reserved",
        )?;
        let it = &mut self.shader.variables[index as usize];
        (it.of, it.is_used, it.is_active) = (of, it.is_used || of.is_array(), of.is_array());
        it.is_invariant |= qualifiers.is_invariant;
        if !of.is_array() {
            self.shader.depth_layout = depth.or(Some(Known::DepthAny));
        }
        Ok(())
    }

    fn declarator(
        &mut self,
        qualifiers: &Qualifiers,
        storage: Storage,
        of: Type,
        precision: Precision,
        out: &mut Vec<Statement>,
    ) -> Result<()> {
        let name = self.identifier()?;
        let mut of = self.array_size(of)?;
        if self.text(name).starts_with("gl_") {
            return self.redeclare(name, qualifiers, storage, of);
        }
        let (layout, is_attribute) = (
            qualifiers.layout.unwrap_or_default(),
            storage == Storage::Input && self.shader.stage == Stage::Vertex,
        );
        let is_interface = matches!(storage, Storage::Input | Storage::Output);
        self.require(
            of != Type::VOID && layout.depth.is_none(),
            name,
            "a variable cannot have this type",
        )?;
        self.require(
            !(of.is_array()
                && (is_attribute || is_interface && self.shader.structure(of).is_some())),
            name,
            "the inputs of a vertex shader cannot be arrays",
        )?;
        self.require(
            layout.location.is_none() || self.next() != Known::Comma,
            name,
            "a location is for one variable",
        )?;
        let value = if self.eat(Known::Assign) {
            Some(self.assignment()?)
        } else {
            None
        };
        let constant = value.and_then(|it| self.shader.expressions[it as usize].value);
        if let Some(value) = value {
            let given = self.type_of(value);
            if of.length == UNSIZED && given.is_array() {
                of.length = given.length;
            }
            let is_valid = match storage {
                Storage::Local => true,
                Storage::Global => {
                    constant.is_some()
                        || !self.shader.is_es3
                            && self.shader.expressions[value as usize].can_initialize_global
                }
                _ => storage == Storage::Constant && constant.is_some(),
            };
            self.require(
                is_valid,
                name,
                "it cannot be initialized, or only with a constant",
            )?;
            self.require(
                of == given && self.can_be_copied(of),
                name,
                "the initializer has another type",
            )?;
        }
        self.require(
            storage != Storage::Constant || value.is_some(),
            name,
            "a constant needs a value",
        )?;
        self.require_size(of, storage, name)?;
        let variable = self.add_variable(Variable {
            interpolation: qualifiers.interpolation.unwrap_or_default(),
            sampling: qualifiers.sampling,
            is_invariant: qualifiers.is_invariant
                || self.is_all_invariant && storage == Storage::Output,
            location: layout.location,
            index: layout.index,
            value: constant.filter(|_| storage == Storage::Constant),
            ..Variable::new(
                if is_interface || storage == Storage::Uniform {
                    self.text(name)
                } else {
                    ""
                },
                of,
                storage,
                precision,
            )
        });
        self.bind(name, Symbol::Variable(variable))?;
        match self.function {
            Some(_) => out.push(Statement::Declare(variable, value)),
            None => self.shader.globals.push((variable, value)),
        }
        Ok(())
    }

    fn parameter(&mut self) -> Result<(Option<Token>, u32)> {
        let (start, is_const) = (self.peek(), self.eat(Known::Const));
        let known = [
            (Known::In, Direction::In),
            (Known::Out, Direction::Out),
            (Known::Inout, Direction::InOut),
        ];
        let direction = known
            .into_iter()
            .find(|it| self.eat(it.0))
            .map_or(Direction::In, |it| it.1);
        let (precision, (of, defines)) = (self.precision(), self.type_specifier()?);
        let name = if let Word::Free = self.word(self.peek()) {
            self.identifier().ok()
        } else {
            None
        };
        let of = self.array_size(of)?;
        self.require(
            of != Type::VOID && !defines,
            start,
            "a parameter cannot have this type",
        )?;
        self.require(
            direction == Direction::In || !is_const && !self.shader.has_samplers(of),
            start,
            "it can only be passed in",
        )?;
        self.require_size(of, Storage::Local, start)?;
        let storage = Storage::Parameter(if is_const {
            Direction::ConstIn
        } else {
            direction
        });
        Ok((
            name,
            self.add_variable(Variable::new(
                "",
                of,
                storage,
                self.precision_for(of, precision, start)?,
            )),
        ))
    }

    fn function(&mut self, returns: Type, precision: Precision) -> Result<()> {
        let (name, mut names, mut parameters) = (self.identifier()?, Vec::new(), Vec::new());
        self.require(self.function.is_none(), name, "functions cannot be nested")?;
        self.require_size(returns, Storage::Local, name)?;
        self.expect(Known::LeftParen)?;
        if matches!(self.word(self.peek()), Word::Type(Type::VOID))
            && self.is_followed_by(Known::RightParen)
        {
            self.advance();
        }
        while !self.eat(Known::RightParen) {
            if !parameters.is_empty() {
                self.expect(Known::Comma)?;
            }
            let (name_of_parameter, parameter) = self.parameter()?;
            names.push(name_of_parameter);
            parameters.push(parameter);
            self.require(
                parameters.len() <= MAX_DEPTH,
                name,
                "more than 256 parameters",
            )?;
        }
        let (is_es3, is_definition) = (self.shader.is_es3, self.next() == Known::LeftBrace);
        let types: Vec<_> = parameters
            .iter()
            .map(|it| self.shader.variables[*it as usize].of)
            .collect();
        self.require(
            !name.is(Known::Main) || types.is_empty() && returns == Type::VOID,
            name,
            "it has to be void main()",
        )?;
        let mut builtins = builtins::functions(
            self.text(name),
            self.shader.stage,
            is_es3,
            self.shader.extensions,
        );
        self.require(
            !builtins.any(|it| is_es3 || !types.is_empty() && it.result(&types).is_some()),
            name,
            "the language has such a function",
        )?;
        if !matches!(self.find(name), Some(Symbol::Function)) {
            self.bind(name, Symbol::Function)?;
        }
        let count = self.shader.functions.len() as u32;
        let index = *self.signatures.entry((name.name, types)).or_insert(count);
        if let Some(before) = self.shader.functions.get(index as usize) {
            let qualifiers = |it: &u32| {
                (
                    self.shader.variables[*it as usize].storage,
                    self.shader.variables[*it as usize].precision,
                )
            };
            let is_same = before.returns == returns
                && before.precision == precision
                && before
                    .parameters
                    .iter()
                    .map(qualifiers)
                    .eq(parameters.iter().map(qualifiers));
            self.require(is_same, name, "it was declared differently before")?;
            self.require(
                if is_definition {
                    before.body.is_none()
                } else {
                    is_es3 || before.body.is_some()
                },
                name,
                "redefinition",
            )?;
        } else {
            let (body, size, nesting, calls, uses) = Default::default();
            self.shader.functions.push(Function {
                name: self.text(name).into(),
                returns,
                precision,
                parameters: parameters.clone(),
                body,
                size,
                nesting,
                calls,
                uses,
            });
        }
        self.enter();
        for (name, parameter) in names.into_iter().zip(&parameters) {
            name.map_or(Ok(()), |it| self.bind(it, Symbol::Variable(*parameter)))?;
        }
        if is_definition {
            (self.function, self.returns_value, self.size, self.nesting) =
                (Some(index), false, 1, 0);
            let body = self.block()?;
            self.require(
                self.returns_value || returns == Type::VOID,
                name,
                "there is no return statement",
            )?;
            let it = &mut self.shader.functions[index as usize];
            (it.parameters, it.body, it.size, it.nesting) =
                (parameters, Some(body), self.size, self.nesting);
            self.function = None;
        } else {
            self.expect(Known::Semicolon)?;
        }
        self.leave();
        Ok(())
    }

    pub fn check_interface(&mut self) -> Result<()> {
        let at = self.peek();
        for it in self
            .shader
            .variables
            .iter_mut()
            .take_while(|it| it.is_builtin)
            .filter(|it| it.of.length == UNSIZED)
        {
            it.of.length = it.reach;
        }
        let shader = &self.shader;
        let distances: u32 = ["gl_ClipDistance", "gl_CullDistance"]
            .iter()
            .filter_map(|it| shader.builtin(it))
            .map(|it| it.of.length)
            .sum();
        self.require(
            distances <= self.limits.distances[2],
            at,
            "too many clip and cull distances",
        )?;
        let uses_color = shader.uses("gl_FragColor") || shader.uses("gl_SecondaryFragColorEXT");
        self.require(
            !uses_color || !shader.uses("gl_FragData") && !shader.uses("gl_SecondaryFragDataEXT"),
            at,
            "gl_FragColor and gl_FragData exclude each other",
        )?;
        if shader.stage == Stage::Vertex {
            return Ok(());
        }
        let (outputs, mut taken) = (shader.declared(Storage::Output), [0u32; 2]);
        let (is_alone, is_dual) = (
            outputs.clone().count() == 1,
            outputs.clone().any(|it| it.1.index == Some(1)),
        );
        for (_, it) in outputs {
            let Some(first) = it.location.or(is_alone.then_some(0)) else {
                return self.fail("each of several outputs needs a location");
            };
            let limit = if is_dual {
                self.limits.dual_source_draw_buffers
            } else {
                self.limits.draw_buffers
            };
            self.require(
                first + it.of.count() <= limit,
                at,
                "there is no draw buffer for an output",
            )?;
            let (taken, wanted) = (
                &mut taken[it.index.unwrap_or(0) as usize],
                ((1 << it.of.count()) - 1) << first,
            );
            self.require(*taken & wanted == 0, at, "two outputs share a location")?;
            *taken |= wanted;
        }
        Ok(())
    }
}
