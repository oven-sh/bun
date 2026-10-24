use bun_sema::atom::Atom;
use smallvec::SmallVec;

use super::ValidationError;
use crate::lower::{CheckerTypeId, FileLowering};

#[derive(Copy, Clone)]
pub(super) enum Step {
    NamedMember(Atom),
    ArrayElement,
    TupleElement(u32),
    IndexSignatureValue,
    UnionArm,
}

#[derive(Copy, Clone)]
pub(super) struct Origin {
    pub(super) parent: u32,
    pub(super) step: Step,
}

impl FileLowering<'_, '_, '_, '_> {
    pub(super) fn describe_unsupported(
        &mut self,
        origins: &[Option<Origin>],
        origin: Option<Origin>,
        ty: CheckerTypeId,
    ) -> ValidationError {
        let mut steps: SmallVec<[Step; 8]> = SmallVec::new();
        let mut next = origin;
        while let Some(Origin { parent, step }) = next {
            steps.push(step);
            next = origins[parent as usize];
        }
        let mut described = Vec::new();
        for step in steps.into_iter().rev() {
            self.write_step(&mut described, step);
        }
        if !described.is_empty() {
            described.extend_from_slice(b": ");
        }
        described.extend_from_slice(&self.queries.type_text(ty));
        ValidationError::Unsupported { described }
    }

    fn write_step(&self, described: &mut Vec<u8>, step: Step) {
        match step {
            Step::NamedMember(name) => {
                if !described.is_empty() {
                    described.push(b'.');
                }
                described.extend_from_slice(self.queries.atom_bytes(name));
            }
            Step::ArrayElement => described.extend_from_slice(b"[number]"),
            Step::TupleElement(index) => {
                described.extend_from_slice(format!("[{index}]").as_bytes());
            }
            Step::IndexSignatureValue => described.extend_from_slice(b"[string]"),
            Step::UnionArm => {}
        }
    }
}
