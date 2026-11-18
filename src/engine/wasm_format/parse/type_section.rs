use super::section::{Parsed, Section};
use crate::decode::types::{self, ARRAY, FUNC, I8, I16, REC, STRUCT, SUB, SUB_FINAL};
use crate::error::Error;
use crate::index::TypeIndex;
use crate::limits::{MAX_PARAMS, MAX_RESULTS, MAX_STRUCT_FIELDS, MAX_SUBTYPE_DEPTH, MAX_TYPES};
use crate::module::{Features, ModuleHeader};
use crate::reader::sign_extend7;
use crate::types::{FieldType, GroupError, StorageType, Subtyping, TypesBuilder, ValType};

struct TypeSection<'s, 'a> {
    section: &'s mut Section<'a>,
    features: Features,
    types: TypesBuilder,
    /// The index after the last type of the open group.
    group_end: u32,
}

impl Section<'_> {
    pub(super) fn types(&mut self, header: &mut ModuleHeader) -> Parsed {
        let count = self.count("Type", MAX_TYPES)?;
        let mut parser = TypeSection {
            section: self,
            features: header.features,
            types: TypesBuilder::default(),
            group_end: 0,
        };
        for i in 0..count {
            parser.group(i)?;
        }
        header.types = parser.types.finish();
        Ok(())
    }
}

impl TypeSection<'_, '_> {
    fn group(&mut self, position: u32) -> Parsed {
        let s = &mut *self.section;
        let kind = read!(s, s.reader.u7(), "can't get {position}th Type's type");
        if kind != REC {
            self.open_group(1)?;
            self.definition(kind, position)?;
            return self.close_group(|_| format!("Type section's {position}th"));
        }

        let count = read!(
            s,
            s.reader.u32(),
            "can't get {position}th recursion group's type count"
        );
        ensure!(
            s,
            count <= MAX_TYPES,
            "number of types for recursion group at position {position} is too big {count} maximum {MAX_TYPES}"
        );
        if count == 0 {
            return Ok(());
        }
        self.open_group(count)?;
        for i in 0..count {
            let s = &mut *self.section;
            let kind = read!(
                s,
                s.reader.u7(),
                "can't get recursion group's {i}th Type's type"
            );
            self.definition(kind, i)?;
        }
        self.close_group(|member| format!("recursion group's {member}th"))
    }

    fn open_group(&mut self, count: u32) -> Parsed {
        let total = self.types.len() + count;
        ensure!(
            self.section,
            total <= MAX_TYPES,
            "Type section's number of types is too big {total} maximum {MAX_TYPES}"
        );
        self.group_end = total;
        Ok(())
    }

    fn close_group(&mut self, name: impl FnOnce(u32) -> String) -> Parsed {
        let s = &*self.section;
        match self.types.end_group() {
            Ok(()) => Ok(()),
            Err(GroupError::TooDeep { member }) => fail!(
                s,
                "subtype depth for {} signature exceeded the limits of {MAX_SUBTYPE_DEPTH}",
                name(member)
            ),
            Err(GroupError::FinalSupertype) => {
                fail!(s, "cannot declare subtype of final supertype")
            }
            Err(GroupError::SupertypeMismatch) => {
                fail!(
                    s,
                    "structural type is not a subtype of the specified supertype"
                )
            }
            Err(GroupError::OutOfMemory) => Err(s.out_of_memory()),
        }
    }

    fn definition(&mut self, kind: u8, position: u32) -> Parsed {
        let s = &mut *self.section;
        if kind != SUB && kind != SUB_FINAL {
            ensure!(
                s,
                matches!(kind, FUNC | STRUCT | ARRAY),
                "{position}th Type is non-Func, non-Struct, and non-Array {}",
                sign_extend7(kind)
            );
            let sub = Subtyping {
                supertype: None,
                is_final: true,
            };
            return self.composite(kind, position, sub);
        }

        let count = read!(
            s,
            s.reader.u32(),
            "can't get {position}th subtype's supertype count"
        );
        ensure!(
            s,
            count <= 1,
            "number of supertypes for subtype at position {position} is too big {count} maximum 1"
        );
        let mut supertype = None;
        if count == 1 {
            let index = read!(s, s.reader.u32(), "can't get subtype's supertype index");
            ensure!(
                s,
                index < self.types.len(),
                "supertype index is a forward reference"
            );
            supertype = Some(TypeIndex(index));
        }
        let composite = read!(
            s,
            s.reader.u7(),
            "can't get subtype's underlying Type's type"
        );
        ensure!(
            s,
            matches!(composite, FUNC | STRUCT | ARRAY),
            "invalid structural type definition for subtype {}",
            sign_extend7(composite)
        );
        let sub = Subtyping {
            supertype,
            is_final: kind == SUB_FINAL,
        };
        self.composite(composite, position, sub)
    }

    fn composite(&mut self, kind: u8, position: u32, sub: Subtyping) -> Parsed {
        let defined = match kind {
            FUNC => {
                let params = self.signature(position)?;
                self.types.define_func(params, sub)
            }
            STRUCT => {
                self.fields(position)?;
                self.types.define_struct(sub)
            }
            _ => {
                self.element(position)?;
                self.types.define_array(sub)
            }
        };
        defined.map_err(|_| self.section.out_of_memory())
    }

    /// Returns the number of parameters.
    fn signature(&mut self, position: u32) -> Result<u32, Error> {
        let s = &mut *self.section;
        let params = read!(
            s,
            s.reader.u32(),
            "can't get Type's argument count at index {position}"
        );
        ensure!(
            s,
            params <= MAX_PARAMS,
            "argument count of Type at index {position} is too big {params} maximum {MAX_PARAMS}"
        );
        for i in 0..params {
            let ty = read!(
                self.section,
                self.value_type(),
                "can't get {i}th argument Type"
            );
            self.types
                .push_value(ty)
                .map_err(|_| self.section.out_of_memory())?;
        }

        let s = &mut *self.section;
        let results = read!(
            s,
            s.reader.u32(),
            "can't get Type's return count at index {position}"
        );
        ensure!(
            s,
            results <= MAX_RESULTS,
            "return count of Type at index {position} is too big {results} maximum {MAX_RESULTS}"
        );
        for i in 0..results {
            let ty = read!(
                self.section,
                self.value_type(),
                "can't get {i}th Type's return value"
            );
            self.types
                .push_value(ty)
                .map_err(|_| self.section.out_of_memory())?;
        }
        Ok(params)
    }

    fn fields(&mut self, position: u32) -> Parsed {
        let s = &mut *self.section;
        let count = read!(
            s,
            s.reader.u32(),
            "can't get {position}th struct type's field count"
        );
        ensure!(
            s,
            count <= MAX_STRUCT_FIELDS,
            "number of fields for struct type at position {position} is too big {count} maximum {MAX_STRUCT_FIELDS}"
        );
        for i in 0..count {
            let storage = read!(
                self.section,
                self.storage_type(),
                "can't get {i}th field Type"
            );
            let s = &mut *self.section;
            let byte = read!(
                s,
                s.reader.u8(),
                "{position}can't get {i}th field mutability"
            );
            let mutable = s.mutability(byte, "Field's")?;
            let pushed = self.types.push_field(FieldType { storage, mutable });
            pushed.map_err(|_| s.out_of_memory())?;
        }
        Ok(())
    }

    fn element(&mut self, position: u32) -> Parsed {
        let storage = read!(
            self.section,
            self.storage_type(),
            "can't get array's element Type"
        );
        let s = &mut *self.section;
        let byte = read!(s, s.reader.u8(), "{position}can't get array's mutability");
        let mutable = s.mutability(byte, "array")?;
        let pushed = self.types.push_field(FieldType { storage, mutable });
        pushed.map_err(|_| s.out_of_memory())
    }

    fn value_type(&mut self) -> Option<ValType> {
        types::value_type(&mut self.section.reader, self.features, |index| {
            (index < self.group_end).then(|| self.types.heap_type(index))
        })
    }

    fn storage_type(&mut self) -> Option<StorageType> {
        let packed = match self.section.reader.peek()? {
            I8 => StorageType::I8,
            I16 => StorageType::I16,
            0x80.. => return None,
            _ => return self.value_type().map(StorageType::from),
        };
        self.section.reader.u8();
        Some(packed)
    }
}
