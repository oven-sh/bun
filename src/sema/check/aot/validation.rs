use crate::check::Checker;
use crate::hir::{ExprId, ExprKind, FileKind};
use crate::program::{FileId, Sym};
use crate::types::{ElemFlags, EnumValue, Intrinsic, PropFlags, TypeData, TypeId};
use crate::util::FxHashMap;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ValidationCall {
    Validate,
    SafeValidate,
    Schema,
    Parse,
}

#[derive(Clone, PartialEq, Debug)]
pub enum Constant {
    Undefined,
    Null,
    Boolean(bool),
    Number(f64),
    Text(Vec<u8>),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum PlannedPrimitive {
    Text,
    Number,
    Boolean,
    BigInt,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Placeholder {
    Text,
    Number,
    BigInt,
}

#[derive(Clone, PartialEq, Debug)]
pub enum Rule {
    Integer,
    AtLeast(f64),
    AtMost(f64),
    Above(f64),
    Below(f64),
    MultipleOf(f64),
    LengthAtLeast(f64),
    LengthAtMost(f64),
    Pattern(Vec<u8>),
    Format {
        name: Vec<u8>,
        pattern: Vec<u8>,
    },
    Template {
        name: Vec<u8>,
        texts: Vec<Vec<u8>>,
        placeholders: Vec<Placeholder>,
    },
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum OtherKeys {
    Omitted,
    Refused,
    Kept(u32),
}

#[derive(Clone, Debug)]
pub struct PlannedMember {
    pub name: Vec<u8>,
    pub node: u32,
    pub is_optional: bool,
    pub is_omitted_when_invalid: bool,
}

#[derive(Clone, Debug)]
pub enum Planned {
    Anything,
    Nothing,
    Primitive(PlannedPrimitive),
    Value(Constant),
    AnyObject,
    Array {
        ty: TypeId,
        element: u32,
    },
    Tuple {
        ty: TypeId,
        elements: Vec<u32>,
    },
    Dictionary {
        ty: TypeId,
        held: u32,
    },
    Object {
        ty: TypeId,
        members: Vec<PlannedMember>,
        others: OtherKeys,
    },
    Union {
        ty: TypeId,
        arms: Vec<u32>,
    },
}

#[derive(Clone, Debug)]
pub struct PlanNode {
    pub planned: Planned,
    pub rules: Vec<Rule>,
    pub message: Option<Vec<u8>>,
    pub default: Option<Constant>,
    pub is_recursive: bool,
}

#[derive(Default, Debug)]
pub struct ValidationPlan {
    pub nodes: Vec<PlanNode>,
    pub root: u32,
    pub unsupported: Vec<String>,
    pub is_strict_everywhere: bool,
}

fn write_json_text(out: &mut Vec<u8>, text: &[u8]) {
    out.push(b'"');
    for unit in String::from_utf8_lossy(text).encode_utf16() {
        match unit {
            0x22 | 0x5c => out.extend_from_slice(&[b'\\', unit as u8]),
            0x20..=0x7e => out.push(unit as u8),
            _ => out.extend_from_slice(format!("\\u{unit:04x}").as_bytes()),
        }
    }
    out.push(b'"');
}

fn write_json_constant(out: &mut Vec<u8>, constant: &Constant) {
    match constant {
        Constant::Undefined | Constant::Null => out.extend_from_slice(b"null"),
        Constant::Boolean(value) => out.extend_from_slice(if *value { b"true" } else { b"false" }),
        Constant::Number(value) => out.extend_from_slice(format!("{value}").as_bytes()),
        Constant::Text(text) => write_json_text(out, text),
    }
}

fn write_json_list(out: &mut Vec<u8>, numbers: &[u32]) {
    out.push(b'[');
    for (at, number) in numbers.iter().enumerate() {
        if at > 0 {
            out.push(b',');
        }
        out.extend_from_slice(number.to_string().as_bytes());
    }
    out.push(b']');
}

impl ValidationPlan {
    pub fn to_json(&self) -> Vec<u8> {
        let mut out = format!("[{},[", self.root).into_bytes();
        for (at, node) in self.nodes.iter().enumerate() {
            if at > 0 {
                out.push(b',');
            }
            out.push(b'[');
            match &node.planned {
                Planned::Anything => out.extend_from_slice(b"0,null,null"),
                Planned::Nothing => out.extend_from_slice(b"1,null,null"),
                Planned::Primitive(primitive) => out.extend_from_slice(match primitive {
                    PlannedPrimitive::Text => b"2,\"string\",null".as_slice(),
                    PlannedPrimitive::Number => b"2,\"number\",null",
                    PlannedPrimitive::Boolean => b"2,\"boolean\",null",
                    PlannedPrimitive::BigInt => b"2,\"bigint\",null",
                }),
                Planned::Value(Constant::Undefined) => out.extend_from_slice(b"10,null,null"),
                Planned::Value(constant) => {
                    out.extend_from_slice(b"3,");
                    write_json_constant(&mut out, constant);
                    out.extend_from_slice(b",null");
                }
                Planned::AnyObject => out.extend_from_slice(b"4,null,null"),
                Planned::Array { element, .. } => {
                    out.extend_from_slice(format!("5,{element},null").as_bytes())
                }
                Planned::Tuple { elements, .. } => {
                    out.extend_from_slice(b"6,");
                    write_json_list(&mut out, elements);
                    out.extend_from_slice(b",null");
                }
                Planned::Dictionary { held, .. } => {
                    out.extend_from_slice(format!("7,{held},null").as_bytes())
                }
                Planned::Object {
                    members, others, ..
                } => {
                    out.extend_from_slice(b"8,[");
                    for (at, member) in members.iter().enumerate() {
                        if at > 0 {
                            out.push(b',');
                        }
                        out.push(b'[');
                        write_json_text(&mut out, &member.name);
                        out.extend_from_slice(
                            format!(
                                ",{},{}]",
                                member.node,
                                if member.is_omitted_when_invalid {
                                    2
                                } else {
                                    u8::from(member.is_optional)
                                }
                            )
                            .as_bytes(),
                        );
                    }
                    out.extend_from_slice(
                        match others {
                            OtherKeys::Omitted => "],-1".to_string(),
                            OtherKeys::Refused => "],-2".to_string(),
                            OtherKeys::Kept(held) => format!("],{held}"),
                        }
                        .as_bytes(),
                    );
                }
                Planned::Union { arms, .. } => {
                    out.extend_from_slice(b"9,");
                    write_json_list(&mut out, arms);
                    out.extend_from_slice(b",null");
                }
            }
            out.extend_from_slice(b",[");
            for (at, rule) in node.rules.iter().enumerate() {
                if at > 0 {
                    out.push(b',');
                }
                let (name, number) = match rule {
                    Rule::Integer => ("int", None),
                    Rule::AtLeast(n) => ("min", Some(n)),
                    Rule::AtMost(n) => ("max", Some(n)),
                    Rule::Above(n) => ("above", Some(n)),
                    Rule::Below(n) => ("below", Some(n)),
                    Rule::MultipleOf(n) => ("multipleOf", Some(n)),
                    Rule::LengthAtLeast(n) => ("minLength", Some(n)),
                    Rule::LengthAtMost(n) => ("maxLength", Some(n)),
                    Rule::Pattern(_) => ("pattern", None),
                    Rule::Format { .. } => ("format", None),
                    Rule::Template { .. } => ("template", None),
                };
                out.extend_from_slice(format!("[\"{name}\",").as_bytes());
                match (rule, number) {
                    (_, Some(number)) => out.extend_from_slice(format!("{number},null").as_bytes()),
                    (Rule::Pattern(pattern), _) => {
                        write_json_text(&mut out, pattern);
                        out.extend_from_slice(b",null");
                    }
                    (Rule::Format { name, pattern }, _) => {
                        write_json_text(&mut out, pattern);
                        out.push(b',');
                        write_json_text(&mut out, name);
                    }
                    (
                        Rule::Template {
                            name,
                            texts,
                            placeholders,
                        },
                        _,
                    ) => {
                        out.push(b'[');
                        for (at, text) in texts.iter().enumerate() {
                            if at > 0 {
                                out.push(b',');
                            }
                            write_json_text(&mut out, text);
                        }
                        out.extend_from_slice(b"],");
                        write_json_text(&mut out, name);
                        out.push(b',');
                        let kinds: Vec<u8> = placeholders
                            .iter()
                            .map(|placeholder| match placeholder {
                                Placeholder::Text => b's',
                                Placeholder::Number => b'n',
                                Placeholder::BigInt => b'b',
                            })
                            .collect();
                        write_json_text(&mut out, &kinds);
                    }
                    _ => out.extend_from_slice(b"null,null"),
                }
                out.push(b']');
            }
            out.extend_from_slice(b"],");
            match &node.message {
                Some(message) => write_json_text(&mut out, message),
                None => out.extend_from_slice(b"null"),
            }
            out.extend_from_slice(if node.default.is_some() {
                b",true,"
            } else {
                b",false,"
            });
            write_json_constant(&mut out, node.default.as_ref().unwrap_or(&Constant::Null));
            if let Planned::Object { members, .. } = &node.planned {
                let plain_primitives: Vec<u32> = members
                    .iter()
                    .map(|member| match &self.nodes[member.node as usize] {
                        PlanNode {
                            planned: Planned::Primitive(primitive),
                            rules,
                            default: None,
                            ..
                        } if rules.is_empty() => match primitive {
                            PlannedPrimitive::Number => 1,
                            PlannedPrimitive::Text => 2,
                            PlannedPrimitive::Boolean => 3,
                            PlannedPrimitive::BigInt => 0,
                        },
                        _ => 0,
                    })
                    .collect();
                out.push(b',');
                write_json_list(&mut out, &plain_primitives);
            }
            out.push(b']');
        }
        out.extend_from_slice(b"]]");
        out
    }

    fn children(&self, node: u32) -> Vec<u32> {
        match &self.nodes[node as usize].planned {
            Planned::Array { element: one, .. } | Planned::Dictionary { held: one, .. } => {
                vec![*one]
            }
            Planned::Tuple {
                elements: several, ..
            }
            | Planned::Union { arms: several, .. } => several.clone(),
            Planned::Object {
                members, others, ..
            } => members
                .iter()
                .map(|member| member.node)
                .chain(if let OtherKeys::Kept(held) = others {
                    Some(*held)
                } else {
                    None
                })
                .collect(),
            _ => Vec::new(),
        }
    }

    fn omits_members_below(&self, node: u32) -> bool {
        let (mut seen, mut pending) = (vec![false; self.nodes.len()], vec![node]);
        while let Some(next) = pending.pop() {
            if std::mem::replace(&mut seen[next as usize], true) {
                continue;
            }
            if matches!(&self.nodes[next as usize].planned, Planned::Object { members, .. } if members.iter().any(|member| member.is_omitted_when_invalid))
            {
                return true;
            }
            pending.extend(self.children(next));
        }
        false
    }

    pub fn node_identity(&self, node: u32) -> Option<(TypeId, bool, bool)> {
        let described = &self.nodes[node as usize];
        if self.is_strict_everywhere
            || !described.rules.is_empty()
            || described.message.is_some()
            || described.default.is_some()
        {
            return None;
        }
        let (ty, is_strict) = match described.planned {
            Planned::Object { ty, others, .. } => (ty, others == OtherKeys::Refused),
            Planned::Array { ty, .. }
            | Planned::Tuple { ty, .. }
            | Planned::Dictionary { ty, .. }
            | Planned::Union { ty, .. } => (ty, false),
            _ => return None,
        };
        Some((ty, is_strict, self.omits_members_below(node)))
    }

    fn reaches_inline(&self, from: u32, target: u32, seen: &mut Vec<u32>) -> bool {
        let within: &[u32] = match &self.nodes[from as usize].planned {
            Planned::Array { element: one, .. } | Planned::Dictionary { held: one, .. } => {
                std::slice::from_ref(one)
            }
            Planned::Tuple {
                elements: several, ..
            }
            | Planned::Union { arms: several, .. } => several,
            _ => &[],
        };
        within.iter().any(|&next| {
            next == target || {
                let is_new = !seen.contains(&next);
                seen.push(next);
                is_new && self.reaches_inline(next, target, seen)
            }
        })
    }
}

#[derive(Default)]
struct Tags {
    rules: Vec<Rule>,
    message: Option<Vec<u8>>,
    default: Option<Constant>,
    is_strict: bool,
}

#[derive(Default)]
struct Planning {
    plan: ValidationPlan,
    known: FxHashMap<(TypeId, bool), u32>,
    is_strict_everywhere: bool,
    omits_invalid_optional_members: bool,
}

impl Planning {
    fn add(&mut self, planned: Planned) -> u32 {
        self.plan.nodes.push(PlanNode {
            planned,
            rules: Vec::new(),
            message: None,
            default: None,
            is_recursive: false,
        });
        self.plan.nodes.len() as u32 - 1
    }
}

impl Checker<'_, '_> {
    pub fn validation_call(&mut self, file: FileId, e: ExprId) -> Option<(ValidationCall, TypeId)> {
        let ExprKind::Call(_) = self.hir(file)[e].kind else {
            return None;
        };
        let resolved = self.resolved_signature(file, e);
        let (declared_in, func, mapper) = self.sig_decl(resolved.sig?)?;
        let id = self.bound(declared_in).fn_symbol[func.idx()];
        if id.is_none() {
            return None;
        }
        let whole = self.files().canonical(Sym {
            file: declared_in,
            id,
        });
        if !self
            .files()
            .decls(whole)
            .iter()
            .any(|declaration| self.declares_bun_module(declaration.0))
        {
            return None;
        }
        let which = match self.atoms().bytes(self.files().symbol(whole).name) {
            b"validate" => ValidationCall::Validate,
            b"safeValidate" => ValidationCall::SafeValidate,
            b"schema" => ValidationCall::Schema,
            b"parse" => ValidationCall::Parse,
            _ => return None,
        };
        let parameter = self.hir(declared_in)[func].type_params.iter().next()?;
        let declared = self.type_param(declared_in, parameter);
        Some((which, self.types().map(mapper, declared)?))
    }

    pub fn validation_plan(
        &mut self,
        ty: TypeId,
        omits_invalid_optional_members: bool,
    ) -> ValidationPlan {
        let mut planning = Planning {
            omits_invalid_optional_members,
            ..Planning::default()
        };
        let shown = String::from_utf8_lossy(&self.type_to_string(ty)).into_owned();
        planning.plan.root = self.plan_type(&mut planning, ty, &shown);
        for node in 0..planning.plan.nodes.len() as u32 {
            planning.plan.nodes[node as usize].is_recursive =
                planning.plan.reaches_inline(node, node, &mut Vec::new());
        }
        planning.plan.is_strict_everywhere = planning.is_strict_everywhere;
        planning.plan
    }

    fn primitive_constant(&self, ty: TypeId) -> Option<Constant> {
        Some(match *self.data(ty) {
            TypeData::Intrinsic(
                Intrinsic::Void
                | Intrinsic::Undefined
                | Intrinsic::Missing
                | Intrinsic::UndefinedWidening,
            ) => Constant::Undefined,
            TypeData::Intrinsic(Intrinsic::Null | Intrinsic::NullWidening) => Constant::Null,
            TypeData::StringLit { value, .. }
            | TypeData::EnumLit {
                value: EnumValue::String(value),
                ..
            } => Constant::Text(self.atoms().bytes(value).to_vec()),
            TypeData::NumberLit { bits, .. }
            | TypeData::EnumLit {
                value: EnumValue::Number(bits),
                ..
            } => Constant::Number(f64::from_bits(bits)),
            TypeData::BoolLit { value, .. } => Constant::Boolean(value),
            _ => return None,
        })
    }

    fn is_primitive_part(&self, ty: TypeId) -> bool {
        matches!(
            *self.data(ty),
            TypeData::Intrinsic(Intrinsic::String | Intrinsic::Number | Intrinsic::BigInt)
                | TypeData::Template { .. }
                | TypeData::StringLit { .. }
                | TypeData::NumberLit { .. }
                | TypeData::BoolLit { .. }
                | TypeData::EnumLit { .. }
        )
    }

    fn read_tag(
        &mut self,
        planning: &mut Planning,
        part: TypeId,
        tags: &mut Tags,
        at: &str,
    ) -> bool {
        let Some((alias, arguments)) = self.alias_of_type(part) else {
            return false;
        };
        let Some(name) = self.bun_intrinsic(alias) else {
            return false;
        };
        let argument = arguments
            .first()
            .and_then(|&argument| self.primitive_constant(argument));
        let name = self.atoms().bytes(name);
        let rule = match (name, argument) {
            (b"Int", _) => Rule::Integer,
            (b"Min", Some(Constant::Number(n))) => Rule::AtLeast(n),
            (b"Max", Some(Constant::Number(n))) => Rule::AtMost(n),
            (b"Above", Some(Constant::Number(n))) => Rule::Above(n),
            (b"Below", Some(Constant::Number(n))) => Rule::Below(n),
            (b"MultipleOf", Some(Constant::Number(n))) => Rule::MultipleOf(n),
            (b"MinLength" | b"MinItems", Some(Constant::Number(n))) => Rule::LengthAtLeast(n),
            (b"MaxLength" | b"MaxItems", Some(Constant::Number(n))) => Rule::LengthAtMost(n),
            (b"Pattern", Some(Constant::Text(text))) => Rule::Pattern(text),
            (b"Format", Some(Constant::Text(name))) => match format_pattern(&name) {
                Some(pattern) => Rule::Format {
                    name,
                    pattern: pattern.to_vec(),
                },
                None => {
                    planning.plan.unsupported.push(format!(
                        "{at}: {}",
                        String::from_utf8_lossy(&self.type_to_string(part))
                    ));
                    return true;
                }
            },
            (b"Message", Some(Constant::Text(text))) => {
                tags.message = Some(text);
                return true;
            }
            (b"Default", Some(constant)) => {
                tags.default = Some(constant);
                return true;
            }
            (b"Strict", _) => {
                tags.is_strict = true;
                return true;
            }
            (b"DeepStrict", _) => {
                planning.is_strict_everywhere = true;
                return true;
            }
            _ => {
                planning.plan.unsupported.push(format!(
                    "{at}: {}",
                    String::from_utf8_lossy(&self.type_to_string(part))
                ));
                return true;
            }
        };
        tags.rules.push(rule);
        true
    }

    fn template_literal_rule(&mut self, ty: TypeId) -> Option<Rule> {
        let TypeData::Template {
            ref texts,
            ref types,
        } = *self.data(ty)
        else {
            return None;
        };
        let texts: Vec<Vec<u8>> = texts
            .iter()
            .map(|&text| self.atoms().bytes(text).to_vec())
            .collect();
        let placeholders = types
            .iter()
            .map(|&placeholder| match *self.data(placeholder) {
                TypeData::Intrinsic(Intrinsic::String | Intrinsic::Any) => Some(Placeholder::Text),
                TypeData::Intrinsic(Intrinsic::Number) => Some(Placeholder::Number),
                TypeData::Intrinsic(Intrinsic::BigInt) => Some(Placeholder::BigInt),
                _ => None,
            })
            .collect::<Option<Vec<Placeholder>>>()?;
        Some(Rule::Template {
            name: self.type_to_string(ty).to_vec(),
            texts,
            placeholders,
        })
    }

    fn plan_type(&mut self, planning: &mut Planning, ty: TypeId, at: &str) -> u32 {
        let ty = self.reduced(ty);
        let mut tags = Tags::default();
        let mut base = ty;
        if let TypeData::Intersection(ref parts) = *self.data(ty) {
            let parts: Vec<TypeId> = parts.iter().copied().collect();
            let others: Vec<TypeId> = parts
                .into_iter()
                .filter(|&part| !self.read_tag(planning, part, &mut tags, at))
                .collect();
            let primitives: Vec<TypeId> = others
                .iter()
                .copied()
                .filter(|&part| self.is_primitive_part(part))
                .collect();
            let others = if primitives.is_empty() {
                others
            } else {
                primitives
            };
            base = match others[..] {
                [only] => only,
                _ => self.intersection(&others),
            };
        }
        let is_tagged = !tags.rules.is_empty() || tags.message.is_some() || tags.default.is_some();
        let is_strict = tags.is_strict || planning.is_strict_everywhere;
        if !is_tagged && let Some(&known) = planning.known.get(&(base, is_strict)) {
            return known;
        }
        let node = planning.add(Planned::Anything);
        if !is_tagged {
            planning.known.insert((base, is_strict), node);
        }
        let template_rule = self.template_literal_rule(base);
        let planned = if template_rule.is_some() {
            Planned::Primitive(PlannedPrimitive::Text)
        } else {
            self.plan_untagged(planning, base, is_strict, at)
        };
        let rules = template_rule.into_iter().chain(tags.rules).collect();
        planning.plan.nodes[node as usize] = PlanNode {
            planned,
            rules,
            message: tags.message,
            default: tags.default,
            is_recursive: false,
        };
        node
    }

    fn plan_untagged(
        &mut self,
        planning: &mut Planning,
        ty: TypeId,
        is_strict: bool,
        at: &str,
    ) -> Planned {
        if let Some(constant) = self.primitive_constant(ty) {
            return Planned::Value(constant);
        }
        let unsupported = |checker: &mut Self, planning: &mut Planning| {
            planning.plan.unsupported.push(format!(
                "{at}: {}",
                String::from_utf8_lossy(&checker.type_to_string(ty))
            ));
            Planned::Anything
        };
        match *self.data(ty) {
            TypeData::Intrinsic(Intrinsic::Any | Intrinsic::Unknown) => Planned::Anything,
            TypeData::Intrinsic(
                Intrinsic::Never
                | Intrinsic::SilentNever
                | Intrinsic::UnreachableNever
                | Intrinsic::ImplicitNever,
            ) => Planned::Nothing,
            TypeData::Intrinsic(Intrinsic::String) => Planned::Primitive(PlannedPrimitive::Text),
            TypeData::Intrinsic(Intrinsic::Number) => Planned::Primitive(PlannedPrimitive::Number),
            TypeData::Intrinsic(Intrinsic::BigInt) => Planned::Primitive(PlannedPrimitive::BigInt),
            TypeData::Intrinsic(Intrinsic::Object) => Planned::AnyObject,
            TypeData::Union(_) => {
                let parts = self.parts(ty).to_vec();
                let has = |constant: bool| {
                    parts.iter().any(|&part| matches!(*self.data(part), TypeData::BoolLit { value, .. } if value == constant))
                };
                let is_boolean_whole = has(true) && has(false);
                let mut arms = Vec::new();
                if is_boolean_whole {
                    arms.push(planning.add(Planned::Primitive(PlannedPrimitive::Boolean)));
                }
                for &part in &parts {
                    if is_boolean_whole && matches!(self.data(part), TypeData::BoolLit { .. }) {
                        continue;
                    }
                    arms.push(self.plan_type(planning, part, at));
                }
                if let [only] = arms[..] {
                    return planning.plan.nodes[only as usize].planned.clone();
                }
                Planned::Union { ty, arms }
            }
            TypeData::Tuple { ref flags, .. } => {
                if flags.iter().any(|flag| {
                    flag.intersects(ElemFlags::OPTIONAL | ElemFlags::REST | ElemFlags::VARIADIC)
                }) {
                    return unsupported(self, planning);
                }
                let elements = self.type_arguments(ty).to_vec();
                let elements = elements
                    .iter()
                    .enumerate()
                    .map(|(index, &element)| {
                        self.plan_type(planning, element, &format!("{at}[{index}]"))
                    })
                    .collect();
                Planned::Tuple { ty, elements }
            }
            _ if self.is_array(ty) => match self.type_arguments(ty).first() {
                Some(&element) => Planned::Array {
                    ty,
                    element: self.plan_type(planning, element, &format!("{at}[number]")),
                },
                None => unsupported(self, planning),
            },
            TypeData::Ref { .. }
            | TypeData::Anon { .. }
            | TypeData::Synth(_)
            | TypeData::Intersection(_)
            | TypeData::ReverseMapped { .. } => {
                let Some(members) = self.members(ty) else {
                    return unsupported(self, planning);
                };
                let shape = members.shape();
                if !shape.call.is_empty() || !shape.construct.is_empty() {
                    return unsupported(self, planning);
                }
                let retained = shape
                    .index
                    .iter()
                    .find(|info| info.key == TypeId::STRING)
                    .map(|info| info.value);
                let props: Vec<_> = shape.props.iter().collect();
                let is_declared_externally = matches!(*self.data(ty), TypeData::Ref { target, .. } if self.hir(target.file).kind == FileKind::Declaration);
                if is_declared_externally
                    && props
                        .iter()
                        .any(|prop| prop.flags.contains(PropFlags::METHOD))
                {
                    return unsupported(self, planning);
                }
                if let (true, Some(held)) = (props.is_empty(), retained) {
                    return Planned::Dictionary {
                        ty,
                        held: self.plan_type(planning, held, &format!("{at}[string]")),
                    };
                }
                let mut planned = Vec::with_capacity(props.len());
                for prop in props {
                    let declared = self.type_of_prop(prop, members.mapper);
                    let name = self.atoms().bytes(prop.name).to_vec();
                    let node = self.plan_type(
                        planning,
                        declared,
                        &format!("{at}.{}", String::from_utf8_lossy(&name)),
                    );
                    let is_optional = prop.flags.contains(PropFlags::OPTIONAL);
                    planned.push(PlannedMember {
                        name,
                        node,
                        is_optional,
                        is_omitted_when_invalid: is_optional
                            && planning.omits_invalid_optional_members,
                    });
                }
                let others = match retained {
                    Some(held) => {
                        OtherKeys::Kept(self.plan_type(planning, held, &format!("{at}[string]")))
                    }
                    None if is_strict => OtherKeys::Refused,
                    None => OtherKeys::Omitted,
                };
                Planned::Object {
                    ty,
                    members: planned,
                    others,
                }
            }
            _ => unsupported(self, planning),
        }
    }
}

fn format_pattern(name: &[u8]) -> Option<&'static [u8]> {
    let pattern: &'static [u8] = match name {
        b"email" => br"^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$",
        b"uuid" => br"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
        b"ipv4" => br"^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$",
        b"ipv6" => br"^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$",
        b"date" => br"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$",
        b"date-time" => br"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$",
        b"url" => b"",
        _ => return None,
    };
    Some(pattern)
}
