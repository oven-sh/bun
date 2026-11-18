use std::rc::Rc;

use super::{Decoder, Place, Writer, flag};
use crate::bytes::{Reader, fold_sign, unfold_sign};
use crate::cache::format::{CodeHead, Variants, signature};
use crate::code::{
    Body, Code, CodeFlags, CodeKind, Handler, HandlerKind, IntCases, IntSwitch, Storage,
    StringSwitch, SuspendPoint, Tables,
};
use crate::function::{FunctionInfo, Origin};
use crate::operand::{Field, Register, SuspendKind};
use crate::verifier::verify_stored;

impl Writer<'_> {
    fn tables(&mut self, tables: &Tables) {
        self.list(&tables.handlers, |w, handler| {
            let bytes = w.bytes();
            bytes.push(handler.kind as u8);
            bytes.number(handler.range.start);
            bytes.near(handler.range.start, handler.range.end);
            bytes.near(handler.range.end, handler.target);
        });
        self.list(&tables.int_switches, |w, switch| {
            let default = switch.default;
            w.bytes().number(default);
            match &switch.cases {
                IntCases::Dense { first, targets } => {
                    w.bytes().push(1);
                    w.bytes().number(fold_sign(*first));
                    w.list(targets, |w, &target| w.bytes().near(default, target));
                }
                IntCases::Sparse(cases) => {
                    w.bytes().push(0);
                    let mut last = 0;
                    w.list(cases, |w, &(key, target)| {
                        w.bytes().near(last, key as u32);
                        w.bytes().near(default, target);
                        last = key as u32;
                    });
                }
            }
        });
        self.list(&tables.string_switches, |w, switch| {
            w.bytes().number(switch.default);
            w.list(&switch.targets, |w, &it| w.bytes().near(switch.default, it));
        });
        self.list(&tables.spread_masks, |w, mask| {
            w.list(mask, |w, &word| w.bytes().number(word));
        });
        let (mut offset, mut saved) = (0, 0);
        self.list(&tables.suspend_points, |w, point| {
            let bytes = w.bytes();
            bytes.push(point.kind as u8);
            bytes.near(offset, point.suspend);
            bytes.near(point.suspend, point.resume);
            bytes.near(saved, point.registers.start);
            bytes.near(point.registers.start, point.registers.end);
            (offset, saved) = (point.resume, point.registers.end);
        });
        let mut last = 0;
        self.list(&tables.saved_registers, |w, saved| {
            w.bytes().near(last, saved.register.word());
            last = saved.register.word();
        });
    }

    pub(in crate::cache) fn function_code(
        &mut self,
        function: &FunctionInfo,
        code: &Code,
        place: Place<'_>,
    ) {
        self.scopes.reset(function.scope.as_ref());
        self.bytes().push(signature(function));
        self.code(code, place);
    }

    /// The instructions take what is left of the record.
    pub(super) fn code(&mut self, code: &Code, place: Place<'_>) {
        let body = &code.body;
        let tools = CodeFlags::HAS_DEBUG_HOOKS | CodeFlags::HAS_COVERAGE;
        self.is_unencodable |= body.flags.intersects(tools);
        let positions = self.require(body.position_bytes());
        let has_lists = !code.name_lists.is_empty() || !code.string_switches.is_empty();
        let mut head = CodeHead::empty();
        for (bit, flag) in CodeHead::FLAGS {
            head.set(bit, body.flags.contains(flag));
        }
        head.set(CodeHead::HAS_POSITIONS, !positions.is_empty());
        head.set(CodeHead::HAS_SCOPES, !code.scopes.is_empty());
        head.set(CodeHead::HAS_FUNCTIONS, !code.functions.is_empty());
        head.set(CodeHead::HAS_LISTS, has_lists);
        head.set(CodeHead::HAS_TABLES, body.tables.is_some());
        let bytes = self.bytes();
        bytes.put(&[head.bits(), body.layout_size]);
        bytes.number(body.locals);
        bytes.number(body.parameters);
        self.identifiers(&code.identifiers);
        self.list(&code.constants, Self::constant);
        if head.contains(CodeHead::HAS_SCOPES) {
            self.list(&code.scopes, Self::scope);
        }
        if head.contains(CodeHead::HAS_FUNCTIONS) {
            self.functions(&code.functions, place);
        }
        if has_lists {
            self.list(&code.name_lists, |w, names| w.identifiers(names));
            self.list(&code.string_switches, |w, keys| w.list(keys, Self::atom));
        }
        if let Some(tables) = &body.tables {
            self.tables(tables);
        }
        if !positions.is_empty() {
            self.blob(positions);
        }
        let instructions = self.require(body.layout_and_instructions());
        self.bytes().put(instructions);
    }
}

fn tables(reader: &mut Reader<'_>) -> Option<Tables> {
    let handlers = reader.list(|reader| {
        let kind = HandlerKind::at(reader.byte()?.into())?;
        let start = reader.number()?;
        let end = reader.near(start)?;
        Some(Handler {
            range: start..end,
            target: reader.near(end)?,
            kind,
        })
    })?;
    let int_switches = reader.list(|reader| {
        let default = reader.number()?;
        let cases = if flag(reader)? {
            IntCases::Dense {
                first: unfold_sign(reader.number()?),
                targets: reader.list(|reader| reader.near(default))?,
            }
        } else {
            let mut key = 0;
            IntCases::Sparse(reader.list(|reader| {
                key = reader.near(key)?;
                Some((key as i32, reader.near(default)?))
            })?)
        };
        Some(IntSwitch { default, cases })
    })?;
    let string_switches = reader.list(|reader| {
        let default = reader.number()?;
        let targets = reader.list(|reader| reader.near(default))?;
        Some(StringSwitch { default, targets })
    })?;
    let spread_masks = reader.list(|reader| reader.list(Reader::number))?;
    let (mut offset, mut saved) = (0, 0);
    let suspend_points = reader.list(|reader| {
        let kind = u32::from(reader.byte()?);
        let suspend = reader.near(offset)?;
        offset = reader.near(suspend)?;
        let start = reader.near(saved)?;
        saved = reader.near(start)?;
        (kind < SuspendKind::COUNT).then(|| SuspendPoint {
            suspend,
            resume: offset,
            kind: SuspendKind::from_word(kind),
            registers: start..saved,
        })
    })?;
    let mut last = 0;
    let saved_registers = reader.list(|reader| {
        last = reader.near(last)?;
        Some(Register::from_word(last))
    })?;
    let mut tables = Tables {
        handlers,
        int_switches,
        string_switches,
        spread_masks,
        suspend_points,
        ..Tables::default()
    };
    tables.set_saved_registers(&saved_registers);
    Some(tables)
}

impl Decoder<'_> {
    pub(in crate::cache) fn code(
        &mut self,
        reader: &mut Reader<'_>,
        kind: CodeKind,
    ) -> Option<Rc<Code>> {
        let [head, layout_size] = reader.array()?;
        let (head, mut flags) = (CodeHead::from_bits_retain(head), CodeFlags::empty());
        for (bit, flag) in CodeHead::FLAGS {
            flags.set(flag, head.contains(bit));
        }
        let origin = self.function.map_or(self.unit.origin, |it| it.origin);
        flags.set(CodeFlags::BUILTIN, origin.contains(Origin::BUILTIN));
        let (locals, parameters) = (reader.number()?, reader.number()?);
        let identifiers = self.identifiers(reader)?;
        self.unit.suits(&identifiers).then_some(())?;
        let constants = reader.list(|reader| self.constant(reader, false))?;
        let scopes = match head.contains(CodeHead::HAS_SCOPES) {
            true => reader.list(|reader| self.scope(reader, false))?,
            false => Box::default(),
        };
        let functions = match head.contains(CodeHead::HAS_FUNCTIONS) {
            true => self.functions(reader)?,
            false => Rc::clone(&self.unit.loader.no_functions),
        };
        let (name_lists, string_switches) = match head.contains(CodeHead::HAS_LISTS) {
            true => (
                reader.list(|reader| self.identifiers(reader))?,
                reader.list(|reader| self.atoms(reader))?,
            ),
            false => Default::default(),
        };
        let tables = match head.contains(CodeHead::HAS_TABLES) {
            true => Some(Box::new(tables(reader)?)),
            false => None,
        };
        let positions_at = match head.contains(CodeHead::HAS_POSITIONS) {
            true => reader.fixed()?,
            false => 0,
        };
        let payload = &self.unit.payload;
        let instructions = reader.rest().get(usize::from(layout_size)..)?;
        let start = instructions.as_ptr().addr() - payload.bytes().as_ptr().addr();
        let code = Code {
            body: Body {
                storage: Storage::Borrowed(payload.clone()),
                tables,
                start: u32::try_from(start).ok()?,
                instructions_size: instructions.len() as u32,
                positions_at,
                locals,
                parameters,
                kind,
                flags,
                layout_size,
            },
            identifiers,
            constants,
            functions,
            scopes,
            name_lists,
            string_switches,
            machine_code: Default::default(),
        };
        (self.is_trusted() || self.is_well_formed(&code)).then(|| Rc::new(code))
    }

    fn is_well_formed(&self, code: &Code) -> bool {
        let flags = code.body.flags;
        let is_strict = flags.contains(CodeFlags::STRICT);
        let suspends = flags.contains(CodeFlags::SUSPENDS);
        let fits = match self.function {
            Some(it) => {
                is_strict == it.is_strict() && suspends == (it.is_generator() || it.awaits())
            }
            None if code.body.kind == CodeKind::Module => is_strict,
            None => !suspends,
        };
        let scope = match code.body.kind {
            CodeKind::Module => self.scopes.first(),
            _ => self.outer,
        };
        fits && (is_strict || !flags.contains(CodeFlags::HAS_TAIL_CALLS))
            && (!is_strict || code.functions.iter().all(FunctionInfo::is_strict))
            && verify_stored(code, scope.map(|it| &**it)).is_ok()
    }
}
