use bun_sema::atom::Atom;
use bun_sema::check::aot::WrittenValue;
use bun_sema::hir::{ExprId, ExprKind, MemberKey, PropKey, PropKind, UnOp, is_proto_setter};
use bun_sema::program::FileId;

use super::ValidatedFile;

const MAX_VALUES_READ: u32 = 1 << 16;
const MAX_DEPTH_OF_NAMES: u32 = 64;

/// The expression at which the reading ended.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) struct NotRead {
    pub(super) file: FileId,
    pub(super) expression: ExprId,
}

struct Reader<'f, F> {
    file: &'f F,
    remaining_values: u32,
}

/// What the expression evaluates to if nothing has changed the objects that its names hold: literals, names of bindings that are never stored to, members of such values, spreads of them,
/// and `Object.freeze()` around them.
pub(super) fn read_written_value<'c, 'p: 'c, 's: 'p>(
    file: &impl ValidatedFile<'c, 'p, 's>,
    written_in: FileId,
    expression: ExprId,
) -> Result<WrittenValue, NotRead> {
    let mut reader = Reader {
        file,
        remaining_values: MAX_VALUES_READ,
    };
    reader.read(written_in, expression, 0)
}

// An integer index goes before every other key, in ascending order.
fn find_index(key: &[u8]) -> Option<u32> {
    let is_canonical =
        matches!(key, [b'0'] | [b'1'..=b'9', ..]) && key.iter().all(u8::is_ascii_digit);
    if !is_canonical || key.len() > 10 {
        return None;
    }
    let index: u64 = std::str::from_utf8(key).ok()?.parse().ok()?;
    (index < u64::from(u32::MAX)).then_some(index as u32)
}

impl<'c, 'p: 'c, 's: 'p, F: ValidatedFile<'c, 'p, 's>> Reader<'_, F> {
    fn define(&self, properties: &mut Vec<(Atom, WrittenValue)>, key: Atom, value: WrittenValue) {
        if let Some(known) = properties.iter_mut().find(|known| known.0 == key) {
            known.1 = value;
            return;
        }
        let index_of = |key: Atom| find_index(self.file.atom_bytes(key));
        let at = match index_of(key) {
            Some(index) => properties
                .iter()
                .position(|known| index_of(known.0).is_none_or(|other| other > index)),
            None => None,
        };
        properties.insert(at.unwrap_or(properties.len()), (key, value));
    }

    fn read(
        &mut self,
        file: FileId,
        expression: ExprId,
        depth: u32,
    ) -> Result<WrittenValue, NotRead> {
        let not_read = NotRead { file, expression };
        if self.remaining_values == 0 || depth > MAX_DEPTH_OF_NAMES {
            return Err(not_read);
        }
        self.remaining_values -= 1;
        let bindings = self.file.named_values();
        let written = bindings
            .find_initializer(file, expression)
            .ok_or(not_read)?;
        let (file, expression) = (written.file, written.expr);
        let not_read = NotRead { file, expression };
        let hir = self.file.files().hir(file);
        match hir[expression].kind {
            ExprKind::Null => Ok(WrittenValue::Null),
            ExprKind::True => Ok(WrittenValue::Boolean(true)),
            ExprKind::False => Ok(WrittenValue::Boolean(false)),
            ExprKind::Number(number) if hir.numbers[number as usize].is_finite() => {
                Ok(WrittenValue::Number(hir.numbers[number as usize]))
            }
            ExprKind::String(text) => Ok(WrittenValue::String(text)),
            ExprKind::Unary {
                op: UnOp::Minus,
                operand,
            } => match hir[hir.skip_type_assertions(operand)].kind {
                ExprKind::Number(number) if hir.numbers[number as usize].is_finite() => {
                    Ok(WrittenValue::Number(-hir.numbers[number as usize]))
                }
                _ => Err(not_read),
            },
            ExprKind::Array(elements) => {
                let mut values = Vec::new();
                for element in hir.ids(elements) {
                    match hir[element].kind {
                        ExprKind::Missing => return Err(not_read),
                        ExprKind::Spread(spread) => match self.read(file, spread, depth + 1)? {
                            WrittenValue::Array(spread) => values.extend(spread),
                            _ => {
                                return Err(NotRead {
                                    file,
                                    expression: spread,
                                });
                            }
                        },
                        _ => values.push(self.read(file, element, depth + 1)?),
                    }
                }
                Ok(WrittenValue::Array(values))
            }
            ExprKind::Object(written) => {
                let mut properties = Vec::new();
                for property in written.iter() {
                    let value = hir[property].value;
                    if is_proto_setter(&hir[property]) {
                        return Err(not_read);
                    }
                    match (hir[property].kind, hir.runtime_property_key(property)) {
                        (PropKind::Init | PropKind::Shorthand, PropKey::Name(key)) => {
                            let value = self.read(file, value, depth + 1)?;
                            self.define(&mut properties, key, value);
                        }
                        (PropKind::Spread, _) => match self.read(file, value, depth + 1)? {
                            WrittenValue::Object(spread) => {
                                for (key, value) in spread {
                                    self.define(&mut properties, key, value);
                                }
                            }
                            _ => {
                                return Err(NotRead {
                                    file,
                                    expression: value,
                                });
                            }
                        },
                        _ => return Err(not_read),
                    }
                }
                Ok(WrittenValue::Object(properties))
            }
            ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                let (holder, key) = hir.member_key(expression).ok_or(not_read)?;
                let holder = self.read(file, holder, depth + 1)?;
                let member = match (holder, key) {
                    (WrittenValue::Object(properties), MemberKey::Name(name)) => properties
                        .into_iter()
                        .find(|property| property.0 == name)
                        .map(|property| property.1),
                    (WrittenValue::Array(mut elements), MemberKey::Computed(index)) => {
                        match hir[hir.skip_type_assertions(index)].kind {
                            ExprKind::Number(number) => {
                                let number = hir.numbers[number as usize];
                                let index = number as usize;
                                (index as f64 == number && index < elements.len())
                                    .then(|| elements.swap_remove(index))
                            }
                            _ => None,
                        }
                    }
                    _ => None,
                };
                member.ok_or(not_read)
            }
            ExprKind::Call(_) => {
                let frozen = bindings
                    .find_frozen_value(file, expression)
                    .ok_or(not_read)?;
                self.read(file, frozen, depth + 1)
            }
            _ => Err(not_read),
        }
    }
}
