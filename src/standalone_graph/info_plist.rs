//! Reads the file `--macos-info-plist` / `compile.macos.infoPlist` names and checks that it is an Info.plist.

use bun_ast::E;
use bun_ast::expr::Data;
use bun_exe_format::macho::INFO_PLIST_MAX_LEN;
use bun_parsers::xml::{self, XML};
use bun_sys::{Fd, File, O};

use crate::StandaloneModuleGraph::CompileError;

/// `codesign` refuses an executable whose `__TEXT,__info_plist` is not a property list with a dictionary at its root.
pub fn load(path: &[u8]) -> Result<Box<[u8]>, CompileError> {
    let bytes = match read(path) {
        Ok(bytes) => bytes,
        Err(err) => {
            return Err(CompileError::fmt(format_args!(
                "failed to read the Info.plist {}: {}",
                bun_core::fmt::quote(path),
                err.without_path()
            )));
        }
    };
    if bytes.len() > INFO_PLIST_MAX_LEN {
        return Err(CompileError::fmt(format_args!(
            "{} is too large to embed: an Info.plist can be at most {} bytes",
            bun_core::fmt::quote(path),
            INFO_PLIST_MAX_LEN
        )));
    }
    let checked = if bytes.starts_with(b"bplist0") {
        check_binary(&bytes)
    } else {
        check_xml(&bytes)
    };
    match checked {
        Ok(()) => Ok(bytes.into_boxed_slice()),
        Err(reason) => Err(CompileError::fmt(format_args!(
            "{} is not an Info.plist: {}",
            bun_core::fmt::quote(path),
            bstr::BStr::new(&reason)
        ))),
    }
}

/// Stops one byte past the limit, which is enough to tell that the file is too large.
fn read(path: &[u8]) -> bun_sys::Maybe<Vec<u8>> {
    let file = File::openat(Fd::cwd(), path, O::RDONLY, 0)?;
    let mut bytes = vec![0; INFO_PLIST_MAX_LEN + 1];
    let len = file.read_all(&mut bytes)?;
    bytes.truncate(len);
    Ok(bytes)
}

const NOT_A_DICTIONARY: &[u8] = b"the root of the property list is not a dictionary";

fn check_xml(bytes: &[u8]) -> Result<(), Vec<u8>> {
    let arena = bun_alloc::Arena::default();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let mut log = bun_ast::Log::init();
    let source = bun_ast::Source::init_path_string(b"Info.plist", bytes);
    let options = xml::Options {
        compact: false,
        encoding: xml::InputEncoding::Bytes,
    };
    let Ok(bun_ast::Expr {
        data: Data::EObjectJSON(root),
        ..
    }) = XML::parse(&source, &mut log, &arena, options)
    else {
        const NOT_A_PLIST: &[u8] = b"it is not an XML or binary property list";
        return Err(match log.msgs.first() {
            Some(msg) => [NOT_A_PLIST, b": ", &msg.data.text[..]].concat(),
            None => NOT_A_PLIST.to_vec(),
        });
    };

    // `{ name, attributes, children }`; text, comments and processing instructions have no `name`.
    fn element(value: &E::JsonValue) -> Option<(&[u8], &[E::JsonValue])> {
        let object = value.as_object()?;
        let children = object
            .get(b"children")
            .and_then(E::JsonValue::as_array)
            .map_or(&[][..], E::ArrayJSON::items);
        Some((object.get(b"name")?.as_str()?, children))
    }
    let root = E::JsonValue::Object(root);
    let is_dictionary = match element(&root) {
        // CoreFoundation also reads a document whose root is the dictionary itself.
        Some((b"dict", _)) => true,
        Some((b"plist", children)) => {
            let mut elements = children.iter().filter_map(element);
            matches!(
                (elements.next(), elements.next()),
                (Some((b"dict", _)), None)
            )
        }
        _ => false,
    };
    if is_dictionary {
        Ok(())
    } else {
        Err(NOT_A_DICTIONARY.to_vec())
    }
}

/// The checks of CoreFoundation's `__CFBinaryPlistGetTopLevelInfo`, then that the top object is a dictionary.
fn check_binary(bytes: &[u8]) -> Result<(), Vec<u8>> {
    const TRAILER: usize = 32;
    const MALFORMED: &[u8] = b"the binary property list is malformed";
    // `bplist0?`, at least one byte of objects, the offset table, the trailer.
    if bytes.len() < 8 + 1 + TRAILER {
        return Err(MALFORMED.to_vec());
    }
    let be = |field: &[u8]| {
        field
            .iter()
            .fold(0u64, |value, byte| (value << 8) | u64::from(*byte))
    };
    // 5 unused bytes and the sort version, then these.
    let trailer = &bytes[bytes.len() - TRAILER..];
    let (offset_int_size, object_ref_size) = (u64::from(trailer[6]), u64::from(trailer[7]));
    let (object_count, top_object, offset_table) = (
        be(&trailer[8..16]),
        be(&trailer[16..24]),
        be(&trailer[24..32]),
    );

    let objects_end = (bytes.len() - TRAILER) as u64;
    let well_formed = object_count >= 1
        && top_object < object_count
        && offset_table >= 9
        && offset_table < objects_end
        && offset_int_size >= 1
        && object_ref_size >= 1
        && object_count
            .checked_mul(offset_int_size)
            .and_then(|table| table.checked_add(offset_table))
            == Some(objects_end)
        && (object_ref_size >= 8 || object_count < 1 << (8 * object_ref_size))
        && (offset_int_size >= 8 || offset_table < 1 << (8 * offset_int_size));
    if !well_formed {
        return Err(MALFORMED.to_vec());
    }

    // Big-endian, `offset_int_size` bytes each. An offset wider than 8 bytes keeps its low 8, as in CoreFoundation.
    let offset_of = |object: u64| -> u64 {
        let at = (offset_table + object * offset_int_size) as usize;
        be(&bytes[at..at + offset_int_size as usize])
    };
    if (0..object_count).any(|object| offset_of(object) >= offset_table) {
        return Err(MALFORMED.to_vec());
    }
    let top = offset_of(top_object);
    if top < 8 {
        return Err(MALFORMED.to_vec());
    }
    // The high nibble of an object's first byte is its type: 0xD is a dictionary.
    if bytes[top as usize] >> 4 == 0xD {
        Ok(())
    } else {
        Err(NOT_A_DICTIONARY.to_vec())
    }
}
