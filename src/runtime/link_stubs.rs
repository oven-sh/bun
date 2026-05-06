//! AUTO-GENERATED link stubs for the .classes.ts / JSSink / JS2Zig codegen gap.
//! These exist solely so `cargo build -p bun_bin` links; every body panics.
//! panic-swarm replaces hot-path ones with real ports.
//!
//! Regenerate: scripts/gen-link-stubs.sh   (1500 symbols)
#![allow(non_snake_case, non_upper_case_globals, improper_ctypes_definitions, unused_variables)]

use core::ffi::c_void;
use bun_jsc::{JSGlobalObject, CallFrame, JSValue};

#[unsafe(no_mangle)] pub extern "C" fn ArchiveClass__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!("codegen stub: ArchiveClass__construct") }
#[unsafe(no_mangle)] pub extern "C" fn ArchiveClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: ArchiveClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn ArchiveClass__write(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ArchiveClass__write") }
#[unsafe(no_mangle)] pub extern "C" fn ArchivePrototype__blob(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ArchivePrototype__blob") }
#[unsafe(no_mangle)] pub extern "C" fn ArchivePrototype__bytes(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ArchivePrototype__bytes") }
#[unsafe(no_mangle)] pub extern "C" fn ArchivePrototype__extract(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ArchivePrototype__extract") }
#[unsafe(no_mangle)] pub extern "C" fn ArchivePrototype__files(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ArchivePrototype__files") }
#[unsafe(no_mangle)] pub static Archive__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn ArrayBufferSink__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ArrayBufferSink__construct") }
#[unsafe(no_mangle)] pub extern "C" fn ArrayBufferSink__end(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ArrayBufferSink__end") }
#[unsafe(no_mangle)] pub extern "C" fn ArrayBufferSink__flush(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ArrayBufferSink__flush") }
#[unsafe(no_mangle)] pub extern "C" fn ArrayBufferSink__getInternalFd(_p: *mut c_void) -> JSValue { unreachable!("codegen stub: ArrayBufferSink__getInternalFd") }
#[unsafe(no_mangle)] pub extern "C" fn ArrayBufferSink__memoryCost(_p: *mut c_void) -> usize { unreachable!("codegen stub: ArrayBufferSink__memoryCost") }
#[unsafe(no_mangle)] pub extern "C" fn ArrayBufferSink__start(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ArrayBufferSink__start") }
#[unsafe(no_mangle)] pub extern "C" fn ArrayBufferSink__write(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ArrayBufferSink__write") }
#[unsafe(no_mangle)] pub extern "C" fn AttributeIteratorClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: AttributeIteratorClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn AttributeIteratorPrototype__getThis(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: AttributeIteratorPrototype__getThis") }
#[unsafe(no_mangle)] pub extern "C" fn AttributeIteratorPrototype__next(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: AttributeIteratorPrototype__next") }
#[unsafe(no_mangle)] pub static AttributeIterator__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn BlobClass__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!("codegen stub: BlobClass__construct") }
#[unsafe(no_mangle)] pub extern "C" fn BlobInternalReadableStreamSourceClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: BlobInternalReadableStreamSourceClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn BlobInternalReadableStreamSourcePrototype__arrayBufferFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobInternalReadableStreamSourcePrototype__arrayBufferFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BlobInternalReadableStreamSourcePrototype__blobFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobInternalReadableStreamSourcePrototype__blobFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BlobInternalReadableStreamSourcePrototype__bytesFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobInternalReadableStreamSourcePrototype__bytesFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BlobInternalReadableStreamSourcePrototype__cancelFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobInternalReadableStreamSourcePrototype__cancelFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BlobInternalReadableStreamSourcePrototype__drainFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobInternalReadableStreamSourcePrototype__drainFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BlobInternalReadableStreamSourcePrototype__getIsClosedFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobInternalReadableStreamSourcePrototype__getIsClosedFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BlobInternalReadableStreamSourcePrototype__getOnCloseFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobInternalReadableStreamSourcePrototype__getOnCloseFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BlobInternalReadableStreamSourcePrototype__getOnDrainFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobInternalReadableStreamSourcePrototype__getOnDrainFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BlobInternalReadableStreamSourcePrototype__jsonFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobInternalReadableStreamSourcePrototype__jsonFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BlobInternalReadableStreamSourcePrototype__pullFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobInternalReadableStreamSourcePrototype__pullFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BlobInternalReadableStreamSourcePrototype__setOnCloseFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobInternalReadableStreamSourcePrototype__setOnCloseFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BlobInternalReadableStreamSourcePrototype__setOnDrainFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobInternalReadableStreamSourcePrototype__setOnDrainFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BlobInternalReadableStreamSourcePrototype__startFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobInternalReadableStreamSourcePrototype__startFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BlobInternalReadableStreamSourcePrototype__textFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobInternalReadableStreamSourcePrototype__textFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BlobInternalReadableStreamSourcePrototype__updateRefFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobInternalReadableStreamSourcePrototype__updateRefFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BlobInternalReadableStreamSource__memoryCost(_p: *mut c_void) -> usize { unreachable!("codegen stub: BlobInternalReadableStreamSource__memoryCost") }
#[unsafe(no_mangle)] pub extern "C" fn BlobPrototype__doImage(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobPrototype__doImage") }
#[unsafe(no_mangle)] pub extern "C" fn BlobPrototype__doUnlink(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobPrototype__doUnlink") }
#[unsafe(no_mangle)] pub extern "C" fn BlobPrototype__doWrite(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobPrototype__doWrite") }
#[unsafe(no_mangle)] pub extern "C" fn BlobPrototype__getArrayBuffer(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobPrototype__getArrayBuffer") }
#[unsafe(no_mangle)] pub extern "C" fn BlobPrototype__getBytes(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobPrototype__getBytes") }
#[unsafe(no_mangle)] pub extern "C" fn BlobPrototype__getExists(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobPrototype__getExists") }
#[unsafe(no_mangle)] pub extern "C" fn BlobPrototype__getFormData(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobPrototype__getFormData") }
#[unsafe(no_mangle)] pub extern "C" fn BlobPrototype__getJSON(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobPrototype__getJSON") }
#[unsafe(no_mangle)] pub extern "C" fn BlobPrototype__getLastModified(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobPrototype__getLastModified") }
#[unsafe(no_mangle)] pub extern "C" fn BlobPrototype__getName(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobPrototype__getName") }
#[unsafe(no_mangle)] pub extern "C" fn BlobPrototype__getSize(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobPrototype__getSize") }
#[unsafe(no_mangle)] pub extern "C" fn BlobPrototype__getSlice(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobPrototype__getSlice") }
#[unsafe(no_mangle)] pub extern "C" fn BlobPrototype__getStat(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobPrototype__getStat") }
#[unsafe(no_mangle)] pub extern "C" fn BlobPrototype__getStream(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobPrototype__getStream") }
#[unsafe(no_mangle)] pub extern "C" fn BlobPrototype__getText(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobPrototype__getText") }
#[unsafe(no_mangle)] pub extern "C" fn BlobPrototype__getType(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobPrototype__getType") }
#[unsafe(no_mangle)] pub extern "C" fn BlobPrototype__getWriter(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobPrototype__getWriter") }
#[unsafe(no_mangle)] pub extern "C" fn BlobPrototype__setName(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlobPrototype__setName") }
#[unsafe(no_mangle)] pub extern "C" fn BlockListClass__isBlockList(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlockListClass__isBlockList") }
#[unsafe(no_mangle)] pub extern "C" fn BlockListPrototype__addAddress(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlockListPrototype__addAddress") }
#[unsafe(no_mangle)] pub extern "C" fn BlockListPrototype__addRange(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlockListPrototype__addRange") }
#[unsafe(no_mangle)] pub extern "C" fn BlockListPrototype__addSubnet(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlockListPrototype__addSubnet") }
#[unsafe(no_mangle)] pub extern "C" fn BlockListPrototype__check(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlockListPrototype__check") }
#[unsafe(no_mangle)] pub extern "C" fn BlockListPrototype__rules(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BlockListPrototype__rules") }
#[unsafe(no_mangle)] pub extern "C" fn BuildArtifactPrototype__getArrayBuffer(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BuildArtifactPrototype__getArrayBuffer") }
#[unsafe(no_mangle)] pub extern "C" fn BuildArtifactPrototype__getHash(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BuildArtifactPrototype__getHash") }
#[unsafe(no_mangle)] pub extern "C" fn BuildArtifactPrototype__getJSON(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BuildArtifactPrototype__getJSON") }
#[unsafe(no_mangle)] pub extern "C" fn BuildArtifactPrototype__getLoader(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BuildArtifactPrototype__getLoader") }
#[unsafe(no_mangle)] pub extern "C" fn BuildArtifactPrototype__getMimeType(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BuildArtifactPrototype__getMimeType") }
#[unsafe(no_mangle)] pub extern "C" fn BuildArtifactPrototype__getOutputKind(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BuildArtifactPrototype__getOutputKind") }
#[unsafe(no_mangle)] pub extern "C" fn BuildArtifactPrototype__getPath(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BuildArtifactPrototype__getPath") }
#[unsafe(no_mangle)] pub extern "C" fn BuildArtifactPrototype__getSize(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BuildArtifactPrototype__getSize") }
#[unsafe(no_mangle)] pub extern "C" fn BuildArtifactPrototype__getSlice(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BuildArtifactPrototype__getSlice") }
#[unsafe(no_mangle)] pub extern "C" fn BuildArtifactPrototype__getSourceMap(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BuildArtifactPrototype__getSourceMap") }
#[unsafe(no_mangle)] pub extern "C" fn BuildArtifactPrototype__getStream(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BuildArtifactPrototype__getStream") }
#[unsafe(no_mangle)] pub extern "C" fn BuildArtifactPrototype__getText(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BuildArtifactPrototype__getText") }
#[unsafe(no_mangle)] pub static BuildArtifact__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn BuildMessagePrototype__getColumn(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BuildMessagePrototype__getColumn") }
#[unsafe(no_mangle)] pub extern "C" fn BuildMessagePrototype__getLevel(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BuildMessagePrototype__getLevel") }
#[unsafe(no_mangle)] pub extern "C" fn BuildMessagePrototype__getLine(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BuildMessagePrototype__getLine") }
#[unsafe(no_mangle)] pub extern "C" fn BuildMessagePrototype__getMessage(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BuildMessagePrototype__getMessage") }
#[unsafe(no_mangle)] pub extern "C" fn BuildMessagePrototype__getNotes(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BuildMessagePrototype__getNotes") }
#[unsafe(no_mangle)] pub extern "C" fn BuildMessagePrototype__getPosition(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BuildMessagePrototype__getPosition") }
#[unsafe(no_mangle)] pub extern "C" fn BuildMessagePrototype__toJSON(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BuildMessagePrototype__toJSON") }
#[unsafe(no_mangle)] pub extern "C" fn BuildMessagePrototype__toPrimitive(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BuildMessagePrototype__toPrimitive") }
#[unsafe(no_mangle)] pub extern "C" fn BuildMessagePrototype__toString(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BuildMessagePrototype__toString") }
#[unsafe(no_mangle)] pub static BuildMessage__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn BytesInternalReadableStreamSourceClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: BytesInternalReadableStreamSourceClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn BytesInternalReadableStreamSourcePrototype__arrayBufferFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BytesInternalReadableStreamSourcePrototype__arrayBufferFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BytesInternalReadableStreamSourcePrototype__blobFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BytesInternalReadableStreamSourcePrototype__blobFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BytesInternalReadableStreamSourcePrototype__bytesFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BytesInternalReadableStreamSourcePrototype__bytesFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BytesInternalReadableStreamSourcePrototype__cancelFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BytesInternalReadableStreamSourcePrototype__cancelFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BytesInternalReadableStreamSourcePrototype__drainFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BytesInternalReadableStreamSourcePrototype__drainFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BytesInternalReadableStreamSourcePrototype__getIsClosedFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BytesInternalReadableStreamSourcePrototype__getIsClosedFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BytesInternalReadableStreamSourcePrototype__getOnCloseFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BytesInternalReadableStreamSourcePrototype__getOnCloseFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BytesInternalReadableStreamSourcePrototype__getOnDrainFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BytesInternalReadableStreamSourcePrototype__getOnDrainFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BytesInternalReadableStreamSourcePrototype__jsonFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BytesInternalReadableStreamSourcePrototype__jsonFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BytesInternalReadableStreamSourcePrototype__pullFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BytesInternalReadableStreamSourcePrototype__pullFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BytesInternalReadableStreamSourcePrototype__setOnCloseFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BytesInternalReadableStreamSourcePrototype__setOnCloseFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BytesInternalReadableStreamSourcePrototype__setOnDrainFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BytesInternalReadableStreamSourcePrototype__setOnDrainFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BytesInternalReadableStreamSourcePrototype__startFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BytesInternalReadableStreamSourcePrototype__startFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BytesInternalReadableStreamSourcePrototype__textFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BytesInternalReadableStreamSourcePrototype__textFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BytesInternalReadableStreamSourcePrototype__updateRefFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: BytesInternalReadableStreamSourcePrototype__updateRefFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn BytesInternalReadableStreamSource__memoryCost(_p: *mut c_void) -> usize { unreachable!("codegen stub: BytesInternalReadableStreamSource__memoryCost") }
#[unsafe(no_mangle)] pub extern "C" fn CommentClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: CommentClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn CommentPrototype__after(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: CommentPrototype__after") }
#[unsafe(no_mangle)] pub extern "C" fn CommentPrototype__before(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: CommentPrototype__before") }
#[unsafe(no_mangle)] pub extern "C" fn CommentPrototype__getText(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: CommentPrototype__getText") }
#[unsafe(no_mangle)] pub extern "C" fn CommentPrototype__remove(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: CommentPrototype__remove") }
#[unsafe(no_mangle)] pub extern "C" fn CommentPrototype__removed(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: CommentPrototype__removed") }
#[unsafe(no_mangle)] pub extern "C" fn CommentPrototype__replace(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: CommentPrototype__replace") }
#[unsafe(no_mangle)] pub extern "C" fn CommentPrototype__setText(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: CommentPrototype__setText") }
#[unsafe(no_mangle)] pub static Comment__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn CronJobPrototype__doRef(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: CronJobPrototype__doRef") }
#[unsafe(no_mangle)] pub extern "C" fn CronJobPrototype__doUnref(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: CronJobPrototype__doUnref") }
#[unsafe(no_mangle)] pub extern "C" fn CronJobPrototype__getCron(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: CronJobPrototype__getCron") }
#[unsafe(no_mangle)] pub extern "C" fn CronJobPrototype__stop(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: CronJobPrototype__stop") }
#[unsafe(no_mangle)] pub static CronJob__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn CryptoHasherClass__getAlgorithms(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: CryptoHasherClass__getAlgorithms") }
#[unsafe(no_mangle)] pub extern "C" fn CryptoHasherClass__hash(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: CryptoHasherClass__hash") }
#[unsafe(no_mangle)] pub extern "C" fn CryptoHasherPrototype__copy(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: CryptoHasherPrototype__copy") }
#[unsafe(no_mangle)] pub extern "C" fn CryptoHasherPrototype__digest(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: CryptoHasherPrototype__digest") }
#[unsafe(no_mangle)] pub extern "C" fn CryptoHasherPrototype__getAlgorithm(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: CryptoHasherPrototype__getAlgorithm") }
#[unsafe(no_mangle)] pub extern "C" fn CryptoHasherPrototype__getByteLength(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: CryptoHasherPrototype__getByteLength") }
#[unsafe(no_mangle)] pub extern "C" fn CryptoHasherPrototype__update(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: CryptoHasherPrototype__update") }
#[unsafe(no_mangle)] pub static CryptoHasher__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn CryptoPrototype__getRandomValues(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: CryptoPrototype__getRandomValues") }
#[unsafe(no_mangle)] pub extern "C" fn CryptoPrototype__randomUUID(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: CryptoPrototype__randomUUID") }
#[unsafe(no_mangle)] pub extern "C" fn CryptoPrototype__timingSafeEqual(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: CryptoPrototype__timingSafeEqual") }
#[unsafe(no_mangle)] pub static Crypto__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn DNSResolverClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: DNSResolverClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn DNSResolverPrototype__cancel(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DNSResolverPrototype__cancel") }
#[unsafe(no_mangle)] pub extern "C" fn DNSResolverPrototype__getServers(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DNSResolverPrototype__getServers") }
#[unsafe(no_mangle)] pub extern "C" fn DNSResolverPrototype__resolve(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DNSResolverPrototype__resolve") }
#[unsafe(no_mangle)] pub extern "C" fn DNSResolverPrototype__resolveAny(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DNSResolverPrototype__resolveAny") }
#[unsafe(no_mangle)] pub extern "C" fn DNSResolverPrototype__resolveCaa(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DNSResolverPrototype__resolveCaa") }
#[unsafe(no_mangle)] pub extern "C" fn DNSResolverPrototype__resolveCname(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DNSResolverPrototype__resolveCname") }
#[unsafe(no_mangle)] pub extern "C" fn DNSResolverPrototype__resolveMx(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DNSResolverPrototype__resolveMx") }
#[unsafe(no_mangle)] pub extern "C" fn DNSResolverPrototype__resolveNaptr(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DNSResolverPrototype__resolveNaptr") }
#[unsafe(no_mangle)] pub extern "C" fn DNSResolverPrototype__resolveNs(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DNSResolverPrototype__resolveNs") }
#[unsafe(no_mangle)] pub extern "C" fn DNSResolverPrototype__resolvePtr(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DNSResolverPrototype__resolvePtr") }
#[unsafe(no_mangle)] pub extern "C" fn DNSResolverPrototype__resolveSoa(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DNSResolverPrototype__resolveSoa") }
#[unsafe(no_mangle)] pub extern "C" fn DNSResolverPrototype__resolveSrv(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DNSResolverPrototype__resolveSrv") }
#[unsafe(no_mangle)] pub extern "C" fn DNSResolverPrototype__resolveTxt(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DNSResolverPrototype__resolveTxt") }
#[unsafe(no_mangle)] pub extern "C" fn DNSResolverPrototype__reverse(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DNSResolverPrototype__reverse") }
#[unsafe(no_mangle)] pub extern "C" fn DNSResolverPrototype__setLocalAddress(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DNSResolverPrototype__setLocalAddress") }
#[unsafe(no_mangle)] pub extern "C" fn DNSResolverPrototype__setServers(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DNSResolverPrototype__setServers") }
#[unsafe(no_mangle)] pub static DNSResolver__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPSServerClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: DebugHTTPSServerClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPSServerPrototype__closeIdleConnections(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPSServerPrototype__closeIdleConnections") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPSServerPrototype__dispose(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPSServerPrototype__dispose") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPSServerPrototype__doFetch(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPSServerPrototype__doFetch") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPSServerPrototype__doPublish(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPSServerPrototype__doPublish") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPSServerPrototype__doRef(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPSServerPrototype__doRef") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPSServerPrototype__doReload(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPSServerPrototype__doReload") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPSServerPrototype__doRequestIP(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPSServerPrototype__doRequestIP") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPSServerPrototype__doStop(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPSServerPrototype__doStop") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPSServerPrototype__doSubscriberCount(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPSServerPrototype__doSubscriberCount") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPSServerPrototype__doTimeout(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPSServerPrototype__doTimeout") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPSServerPrototype__doUnref(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPSServerPrototype__doUnref") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPSServerPrototype__doUpgrade(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPSServerPrototype__doUpgrade") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPSServerPrototype__getAddress(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPSServerPrototype__getAddress") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPSServerPrototype__getDevelopment(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPSServerPrototype__getDevelopment") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPSServerPrototype__getHostname(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPSServerPrototype__getHostname") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPSServerPrototype__getId(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPSServerPrototype__getId") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPSServerPrototype__getPendingRequests(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPSServerPrototype__getPendingRequests") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPSServerPrototype__getPendingWebSockets(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPSServerPrototype__getPendingWebSockets") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPSServerPrototype__getPort(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPSServerPrototype__getPort") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPSServerPrototype__getProtocol(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPSServerPrototype__getProtocol") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPSServerPrototype__getURL(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPSServerPrototype__getURL") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPSServer__memoryCost(_p: *mut c_void) -> usize { unreachable!("codegen stub: DebugHTTPSServer__memoryCost") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPServerClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: DebugHTTPServerClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPServerPrototype__closeIdleConnections(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPServerPrototype__closeIdleConnections") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPServerPrototype__dispose(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPServerPrototype__dispose") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPServerPrototype__doFetch(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPServerPrototype__doFetch") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPServerPrototype__doPublish(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPServerPrototype__doPublish") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPServerPrototype__doRef(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPServerPrototype__doRef") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPServerPrototype__doReload(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPServerPrototype__doReload") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPServerPrototype__doRequestIP(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPServerPrototype__doRequestIP") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPServerPrototype__doStop(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPServerPrototype__doStop") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPServerPrototype__doSubscriberCount(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPServerPrototype__doSubscriberCount") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPServerPrototype__doTimeout(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPServerPrototype__doTimeout") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPServerPrototype__doUnref(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPServerPrototype__doUnref") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPServerPrototype__doUpgrade(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPServerPrototype__doUpgrade") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPServerPrototype__getAddress(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPServerPrototype__getAddress") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPServerPrototype__getDevelopment(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPServerPrototype__getDevelopment") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPServerPrototype__getHostname(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPServerPrototype__getHostname") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPServerPrototype__getId(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPServerPrototype__getId") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPServerPrototype__getPendingRequests(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPServerPrototype__getPendingRequests") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPServerPrototype__getPendingWebSockets(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPServerPrototype__getPendingWebSockets") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPServerPrototype__getPort(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPServerPrototype__getPort") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPServerPrototype__getProtocol(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPServerPrototype__getProtocol") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPServerPrototype__getURL(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DebugHTTPServerPrototype__getURL") }
#[unsafe(no_mangle)] pub extern "C" fn DebugHTTPServer__memoryCost(_p: *mut c_void) -> usize { unreachable!("codegen stub: DebugHTTPServer__memoryCost") }
#[unsafe(no_mangle)] pub extern "C" fn DocEndClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: DocEndClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn DocEndPrototype__append(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DocEndPrototype__append") }
#[unsafe(no_mangle)] pub static DocEnd__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn DocTypeClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: DocTypeClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn DocTypePrototype__name(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DocTypePrototype__name") }
#[unsafe(no_mangle)] pub extern "C" fn DocTypePrototype__publicId(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DocTypePrototype__publicId") }
#[unsafe(no_mangle)] pub extern "C" fn DocTypePrototype__remove(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DocTypePrototype__remove") }
#[unsafe(no_mangle)] pub extern "C" fn DocTypePrototype__removed(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DocTypePrototype__removed") }
#[unsafe(no_mangle)] pub extern "C" fn DocTypePrototype__systemId(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: DocTypePrototype__systemId") }
#[unsafe(no_mangle)] pub static DocType__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub static DoneCallback__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn ElementClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: ElementClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn ElementPrototype__after(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ElementPrototype__after") }
#[unsafe(no_mangle)] pub extern "C" fn ElementPrototype__append(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ElementPrototype__append") }
#[unsafe(no_mangle)] pub extern "C" fn ElementPrototype__before(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ElementPrototype__before") }
#[unsafe(no_mangle)] pub extern "C" fn ElementPrototype__getAttribute(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ElementPrototype__getAttribute") }
#[unsafe(no_mangle)] pub extern "C" fn ElementPrototype__getAttributes(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ElementPrototype__getAttributes") }
#[unsafe(no_mangle)] pub extern "C" fn ElementPrototype__getCanHaveContent(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ElementPrototype__getCanHaveContent") }
#[unsafe(no_mangle)] pub extern "C" fn ElementPrototype__getNamespaceURI(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ElementPrototype__getNamespaceURI") }
#[unsafe(no_mangle)] pub extern "C" fn ElementPrototype__getRemoved(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ElementPrototype__getRemoved") }
#[unsafe(no_mangle)] pub extern "C" fn ElementPrototype__getSelfClosing(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ElementPrototype__getSelfClosing") }
#[unsafe(no_mangle)] pub extern "C" fn ElementPrototype__getTagName(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ElementPrototype__getTagName") }
#[unsafe(no_mangle)] pub extern "C" fn ElementPrototype__hasAttribute(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ElementPrototype__hasAttribute") }
#[unsafe(no_mangle)] pub extern "C" fn ElementPrototype__onEndTag(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ElementPrototype__onEndTag") }
#[unsafe(no_mangle)] pub extern "C" fn ElementPrototype__prepend(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ElementPrototype__prepend") }
#[unsafe(no_mangle)] pub extern "C" fn ElementPrototype__remove(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ElementPrototype__remove") }
#[unsafe(no_mangle)] pub extern "C" fn ElementPrototype__removeAndKeepContent(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ElementPrototype__removeAndKeepContent") }
#[unsafe(no_mangle)] pub extern "C" fn ElementPrototype__removeAttribute(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ElementPrototype__removeAttribute") }
#[unsafe(no_mangle)] pub extern "C" fn ElementPrototype__replace(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ElementPrototype__replace") }
#[unsafe(no_mangle)] pub extern "C" fn ElementPrototype__setAttribute(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ElementPrototype__setAttribute") }
#[unsafe(no_mangle)] pub extern "C" fn ElementPrototype__setInnerContent(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ElementPrototype__setInnerContent") }
#[unsafe(no_mangle)] pub extern "C" fn ElementPrototype__setTagName(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ElementPrototype__setTagName") }
#[unsafe(no_mangle)] pub static Element__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn EndTagClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: EndTagClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn EndTagPrototype__after(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: EndTagPrototype__after") }
#[unsafe(no_mangle)] pub extern "C" fn EndTagPrototype__before(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: EndTagPrototype__before") }
#[unsafe(no_mangle)] pub extern "C" fn EndTagPrototype__getName(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: EndTagPrototype__getName") }
#[unsafe(no_mangle)] pub extern "C" fn EndTagPrototype__remove(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: EndTagPrototype__remove") }
#[unsafe(no_mangle)] pub extern "C" fn EndTagPrototype__setName(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: EndTagPrototype__setName") }
#[unsafe(no_mangle)] pub static EndTag__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub static ExpectAny__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub static ExpectAnything__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub static ExpectArrayContaining__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn ExpectClass__addSnapshotSerializer(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectClass__addSnapshotSerializer") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectClass__any(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectClass__any") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectClass__anything(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectClass__anything") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectClass__arrayContaining(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectClass__arrayContaining") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectClass__assertions(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectClass__assertions") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectClass__call(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectClass__call") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectClass__closeTo(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectClass__closeTo") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectClass__doUnreachable(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectClass__doUnreachable") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectClass__extend(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectClass__extend") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectClass__getStaticNot(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectClass__getStaticNot") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectClass__getStaticRejectsTo(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectClass__getStaticRejectsTo") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectClass__getStaticResolvesTo(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectClass__getStaticResolvesTo") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectClass__hasAssertions(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectClass__hasAssertions") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectClass__objectContaining(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectClass__objectContaining") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectClass__stringContaining(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectClass__stringContaining") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectClass__stringMatching(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectClass__stringMatching") }
#[unsafe(no_mangle)] pub static ExpectCloseTo__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn ExpectCustomAsymmetricMatcherPrototype__asymmetricMatch(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectCustomAsymmetricMatcherPrototype__asymmetricMatch") }
#[unsafe(no_mangle)] pub static ExpectCustomAsymmetricMatcher__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn ExpectMatcherContextPrototype__equals(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectMatcherContextPrototype__equals") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectMatcherContextPrototype__getExpand(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectMatcherContextPrototype__getExpand") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectMatcherContextPrototype__getIsNot(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectMatcherContextPrototype__getIsNot") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectMatcherContextPrototype__getPromise(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectMatcherContextPrototype__getPromise") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectMatcherContextPrototype__getUtils(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectMatcherContextPrototype__getUtils") }
#[unsafe(no_mangle)] pub static ExpectMatcherContext__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn ExpectMatcherUtilsPrototype__matcherHint(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectMatcherUtilsPrototype__matcherHint") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectMatcherUtilsPrototype__printExpected(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectMatcherUtilsPrototype__printExpected") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectMatcherUtilsPrototype__printReceived(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectMatcherUtilsPrototype__printReceived") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectMatcherUtilsPrototype__stringify(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectMatcherUtilsPrototype__stringify") }
#[unsafe(no_mangle)] pub static ExpectMatcherUtils__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub static ExpectObjectContaining__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype___pass(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype___pass") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__fail(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__fail") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__getNot(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__getNot") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__getRejects(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__getRejects") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__getResolves(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__getResolves") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBe(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBe") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeArray(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeArray") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeArrayOfSize(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeArrayOfSize") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeBoolean(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeBoolean") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeCloseTo(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeCloseTo") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeDate(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeDate") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeDefined(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeDefined") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeEmpty(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeEmpty") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeEmptyObject(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeEmptyObject") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeEven(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeEven") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeFalse(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeFalse") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeFalsy(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeFalsy") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeFinite(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeFinite") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeFunction(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeFunction") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeGreaterThan(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeGreaterThan") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeGreaterThanOrEqual(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeGreaterThanOrEqual") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeInstanceOf(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeInstanceOf") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeInteger(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeInteger") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeLessThan(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeLessThan") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeLessThanOrEqual(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeLessThanOrEqual") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeNaN(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeNaN") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeNegative(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeNegative") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeNil(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeNil") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeNull(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeNull") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeNumber(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeNumber") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeObject(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeObject") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeOdd(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeOdd") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeOneOf(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeOneOf") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBePositive(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBePositive") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeString(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeString") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeSymbol(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeSymbol") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeTrue(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeTrue") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeTruthy(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeTruthy") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeTypeOf(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeTypeOf") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeUndefined(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeUndefined") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeValidDate(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeValidDate") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toBeWithin(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toBeWithin") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toContain(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toContain") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toContainAllKeys(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toContainAllKeys") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toContainAllValues(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toContainAllValues") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toContainAnyKeys(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toContainAnyKeys") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toContainAnyValues(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toContainAnyValues") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toContainEqual(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toContainEqual") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toContainKey(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toContainKey") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toContainKeys(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toContainKeys") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toContainValue(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toContainValue") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toContainValues(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toContainValues") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toEndWith(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toEndWith") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toEqual(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toEqual") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toEqualIgnoringWhitespace(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toEqualIgnoringWhitespace") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toHaveBeenCalled(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toHaveBeenCalled") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toHaveBeenCalledOnce(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toHaveBeenCalledOnce") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toHaveBeenCalledTimes(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toHaveBeenCalledTimes") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toHaveBeenCalledWith(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toHaveBeenCalledWith") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toHaveBeenLastCalledWith(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toHaveBeenLastCalledWith") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toHaveBeenNthCalledWith(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toHaveBeenNthCalledWith") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toHaveLastReturnedWith(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toHaveLastReturnedWith") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toHaveLength(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toHaveLength") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toHaveNthReturnedWith(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toHaveNthReturnedWith") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toHaveProperty(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toHaveProperty") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toHaveReturned(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toHaveReturned") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toHaveReturnedTimes(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toHaveReturnedTimes") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toHaveReturnedWith(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toHaveReturnedWith") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toInclude(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toInclude") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toIncludeRepeated(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toIncludeRepeated") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toMatch(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toMatch") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toMatchInlineSnapshot(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toMatchInlineSnapshot") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toMatchObject(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toMatchObject") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toMatchSnapshot(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toMatchSnapshot") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toSatisfy(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toSatisfy") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toStartWith(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toStartWith") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toStrictEqual(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toStrictEqual") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toThrow(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toThrow") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toThrowErrorMatchingInlineSnapshot(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toThrowErrorMatchingInlineSnapshot") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectPrototype__toThrowErrorMatchingSnapshot(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectPrototype__toThrowErrorMatchingSnapshot") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectStaticPrototype__any(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectStaticPrototype__any") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectStaticPrototype__anything(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectStaticPrototype__anything") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectStaticPrototype__arrayContaining(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectStaticPrototype__arrayContaining") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectStaticPrototype__closeTo(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectStaticPrototype__closeTo") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectStaticPrototype__getNot(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectStaticPrototype__getNot") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectStaticPrototype__getRejectsTo(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectStaticPrototype__getRejectsTo") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectStaticPrototype__getResolvesTo(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectStaticPrototype__getResolvesTo") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectStaticPrototype__objectContaining(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectStaticPrototype__objectContaining") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectStaticPrototype__stringContaining(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectStaticPrototype__stringContaining") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectStaticPrototype__stringMatching(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectStaticPrototype__stringMatching") }
#[unsafe(no_mangle)] pub static ExpectStatic__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub static ExpectStringContaining__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub static ExpectStringMatching__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn ExpectTypeOfClass__call(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectTypeOfClass__call") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectTypeOfPrototype__fnOneArgumentReturnsExpectTypeOf(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectTypeOfPrototype__fnOneArgumentReturnsExpectTypeOf") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectTypeOfPrototype__fnOneArgumentReturnsVoid(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectTypeOfPrototype__fnOneArgumentReturnsVoid") }
#[unsafe(no_mangle)] pub extern "C" fn ExpectTypeOfPrototype__getReturnsExpectTypeOf(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ExpectTypeOfPrototype__getReturnsExpectTypeOf") }
#[unsafe(no_mangle)] pub static ExpectTypeOf__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub static Expect__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn FFIPrototype__close(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FFIPrototype__close") }
#[unsafe(no_mangle)] pub extern "C" fn FFIPrototype__getSymbols(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FFIPrototype__getSymbols") }
#[unsafe(no_mangle)] pub static FFI__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn FSWatcherClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: FSWatcherClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn FSWatcherPrototype__doClose(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FSWatcherPrototype__doClose") }
#[unsafe(no_mangle)] pub extern "C" fn FSWatcherPrototype__doRef(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FSWatcherPrototype__doRef") }
#[unsafe(no_mangle)] pub extern "C" fn FSWatcherPrototype__doUnref(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FSWatcherPrototype__doUnref") }
#[unsafe(no_mangle)] pub extern "C" fn FSWatcherPrototype__hasRef(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FSWatcherPrototype__hasRef") }
#[unsafe(no_mangle)] pub static FSWatcher__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn FileInternalReadableStreamSourceClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: FileInternalReadableStreamSourceClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn FileInternalReadableStreamSourcePrototype__cancelFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FileInternalReadableStreamSourcePrototype__cancelFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn FileInternalReadableStreamSourcePrototype__drainFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FileInternalReadableStreamSourcePrototype__drainFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn FileInternalReadableStreamSourcePrototype__getIsClosedFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FileInternalReadableStreamSourcePrototype__getIsClosedFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn FileInternalReadableStreamSourcePrototype__getOnCloseFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FileInternalReadableStreamSourcePrototype__getOnCloseFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn FileInternalReadableStreamSourcePrototype__getOnDrainFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FileInternalReadableStreamSourcePrototype__getOnDrainFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn FileInternalReadableStreamSourcePrototype__pullFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FileInternalReadableStreamSourcePrototype__pullFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn FileInternalReadableStreamSourcePrototype__setFlowingFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FileInternalReadableStreamSourcePrototype__setFlowingFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn FileInternalReadableStreamSourcePrototype__setOnCloseFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FileInternalReadableStreamSourcePrototype__setOnCloseFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn FileInternalReadableStreamSourcePrototype__setOnDrainFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FileInternalReadableStreamSourcePrototype__setOnDrainFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn FileInternalReadableStreamSourcePrototype__setRawModeFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FileInternalReadableStreamSourcePrototype__setRawModeFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn FileInternalReadableStreamSourcePrototype__startFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FileInternalReadableStreamSourcePrototype__startFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn FileInternalReadableStreamSourcePrototype__updateRefFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FileInternalReadableStreamSourcePrototype__updateRefFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn FileInternalReadableStreamSource__memoryCost(_p: *mut c_void) -> usize { unreachable!("codegen stub: FileInternalReadableStreamSource__memoryCost") }
#[unsafe(no_mangle)] pub extern "C" fn FileSink__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FileSink__construct") }
#[unsafe(no_mangle)] pub extern "C" fn FileSink__end(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FileSink__end") }
#[unsafe(no_mangle)] pub extern "C" fn FileSink__flush(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FileSink__flush") }
#[unsafe(no_mangle)] pub extern "C" fn FileSink__getInternalFd(_p: *mut c_void) -> JSValue { unreachable!("codegen stub: FileSink__getInternalFd") }
#[unsafe(no_mangle)] pub extern "C" fn FileSink__memoryCost(_p: *mut c_void) -> usize { unreachable!("codegen stub: FileSink__memoryCost") }
#[unsafe(no_mangle)] pub extern "C" fn FileSink__start(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FileSink__start") }
#[unsafe(no_mangle)] pub extern "C" fn FileSink__write(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FileSink__write") }
#[unsafe(no_mangle)] pub extern "C" fn FileSystemRouterPrototype__getOrigin(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FileSystemRouterPrototype__getOrigin") }
#[unsafe(no_mangle)] pub extern "C" fn FileSystemRouterPrototype__getRoutes(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FileSystemRouterPrototype__getRoutes") }
#[unsafe(no_mangle)] pub extern "C" fn FileSystemRouterPrototype__getStyle(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FileSystemRouterPrototype__getStyle") }
#[unsafe(no_mangle)] pub extern "C" fn FileSystemRouterPrototype__match(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FileSystemRouterPrototype__match") }
#[unsafe(no_mangle)] pub extern "C" fn FileSystemRouterPrototype__reload(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FileSystemRouterPrototype__reload") }
#[unsafe(no_mangle)] pub static FileSystemRouter__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn FrameworkFileSystemRouterClass__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!("codegen stub: FrameworkFileSystemRouterClass__construct") }
#[unsafe(no_mangle)] pub extern "C" fn FrameworkFileSystemRouterClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: FrameworkFileSystemRouterClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn FrameworkFileSystemRouterPrototype__match(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FrameworkFileSystemRouterPrototype__match") }
#[unsafe(no_mangle)] pub extern "C" fn FrameworkFileSystemRouterPrototype__toJSON(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: FrameworkFileSystemRouterPrototype__toJSON") }
#[unsafe(no_mangle)] pub static FrameworkFileSystemRouter__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn GlobPrototype____scan(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: GlobPrototype____scan") }
#[unsafe(no_mangle)] pub extern "C" fn GlobPrototype____scanSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: GlobPrototype____scanSync") }
#[unsafe(no_mangle)] pub extern "C" fn GlobPrototype__match(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: GlobPrototype__match") }
#[unsafe(no_mangle)] pub static Glob__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn Glob__hasPendingActivity(_p: *mut c_void) -> bool { unreachable!("codegen stub: Glob__hasPendingActivity") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__altsvc(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__altsvc") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__detachFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__detachFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__emitAbortToAllStreams(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__emitAbortToAllStreams") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__emitErrorToAllStreams(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__emitErrorToAllStreams") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__flushFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__flushFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__forEachStream(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__forEachStream") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__getBufferSize(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__getBufferSize") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__getCurrentState(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__getCurrentState") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__getEndAfterHeaders(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__getEndAfterHeaders") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__getNextStream(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__getNextStream") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__getStreamContext(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__getStreamContext") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__getStreamState(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__getStreamState") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__goaway(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__goaway") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__hasNativeRead(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__hasNativeRead") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__isStreamAborted(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__isStreamAborted") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__noTrailers(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__noTrailers") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__origin(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__origin") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__ping(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__ping") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__read(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__read") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__request(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__request") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__rstStream(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__rstStream") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__sendTrailers(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__sendTrailers") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__setLocalWindowSize(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__setLocalWindowSize") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__setNativeSocketFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__setNativeSocketFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__setNextStreamID(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__setNextStreamID") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__setStreamContext(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__setStreamContext") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__setStreamPriority(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__setStreamPriority") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__updateSettings(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__updateSettings") }
#[unsafe(no_mangle)] pub extern "C" fn H2FrameParserPrototype__writeStream(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H2FrameParserPrototype__writeStream") }
#[unsafe(no_mangle)] pub static H2FrameParser__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn H3ResponseSink__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H3ResponseSink__construct") }
#[unsafe(no_mangle)] pub extern "C" fn H3ResponseSink__end(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H3ResponseSink__end") }
#[unsafe(no_mangle)] pub extern "C" fn H3ResponseSink__flush(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H3ResponseSink__flush") }
#[unsafe(no_mangle)] pub extern "C" fn H3ResponseSink__getInternalFd(_p: *mut c_void) -> JSValue { unreachable!("codegen stub: H3ResponseSink__getInternalFd") }
#[unsafe(no_mangle)] pub extern "C" fn H3ResponseSink__memoryCost(_p: *mut c_void) -> usize { unreachable!("codegen stub: H3ResponseSink__memoryCost") }
#[unsafe(no_mangle)] pub extern "C" fn H3ResponseSink__start(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H3ResponseSink__start") }
#[unsafe(no_mangle)] pub extern "C" fn H3ResponseSink__write(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: H3ResponseSink__write") }
#[unsafe(no_mangle)] pub extern "C" fn HTMLBundleClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: HTMLBundleClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn HTMLBundlePrototype__getIndex(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTMLBundlePrototype__getIndex") }
#[unsafe(no_mangle)] pub static HTMLBundle__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn HTMLRewriterPrototype__on(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTMLRewriterPrototype__on") }
#[unsafe(no_mangle)] pub extern "C" fn HTMLRewriterPrototype__onDocument(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTMLRewriterPrototype__onDocument") }
#[unsafe(no_mangle)] pub extern "C" fn HTMLRewriterPrototype__transform(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTMLRewriterPrototype__transform") }
#[unsafe(no_mangle)] pub static HTMLRewriter__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn HTTPResponseSink__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPResponseSink__construct") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPResponseSink__end(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPResponseSink__end") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPResponseSink__flush(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPResponseSink__flush") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPResponseSink__getInternalFd(_p: *mut c_void) -> JSValue { unreachable!("codegen stub: HTTPResponseSink__getInternalFd") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPResponseSink__memoryCost(_p: *mut c_void) -> usize { unreachable!("codegen stub: HTTPResponseSink__memoryCost") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPResponseSink__start(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPResponseSink__start") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPResponseSink__write(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPResponseSink__write") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSResponseSink__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPSResponseSink__construct") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSResponseSink__end(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPSResponseSink__end") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSResponseSink__flush(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPSResponseSink__flush") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSResponseSink__getInternalFd(_p: *mut c_void) -> JSValue { unreachable!("codegen stub: HTTPSResponseSink__getInternalFd") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSResponseSink__memoryCost(_p: *mut c_void) -> usize { unreachable!("codegen stub: HTTPSResponseSink__memoryCost") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSResponseSink__start(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPSResponseSink__start") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSResponseSink__write(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPSResponseSink__write") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSServerClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: HTTPSServerClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSServerPrototype__closeIdleConnections(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPSServerPrototype__closeIdleConnections") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSServerPrototype__dispose(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPSServerPrototype__dispose") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSServerPrototype__doFetch(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPSServerPrototype__doFetch") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSServerPrototype__doPublish(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPSServerPrototype__doPublish") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSServerPrototype__doRef(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPSServerPrototype__doRef") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSServerPrototype__doReload(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPSServerPrototype__doReload") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSServerPrototype__doRequestIP(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPSServerPrototype__doRequestIP") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSServerPrototype__doStop(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPSServerPrototype__doStop") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSServerPrototype__doSubscriberCount(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPSServerPrototype__doSubscriberCount") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSServerPrototype__doTimeout(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPSServerPrototype__doTimeout") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSServerPrototype__doUnref(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPSServerPrototype__doUnref") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSServerPrototype__doUpgrade(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPSServerPrototype__doUpgrade") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSServerPrototype__getAddress(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPSServerPrototype__getAddress") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSServerPrototype__getDevelopment(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPSServerPrototype__getDevelopment") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSServerPrototype__getHostname(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPSServerPrototype__getHostname") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSServerPrototype__getId(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPSServerPrototype__getId") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSServerPrototype__getPendingRequests(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPSServerPrototype__getPendingRequests") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSServerPrototype__getPendingWebSockets(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPSServerPrototype__getPendingWebSockets") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSServerPrototype__getPort(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPSServerPrototype__getPort") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSServerPrototype__getProtocol(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPSServerPrototype__getProtocol") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSServerPrototype__getURL(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPSServerPrototype__getURL") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPSServer__memoryCost(_p: *mut c_void) -> usize { unreachable!("codegen stub: HTTPSServer__memoryCost") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPServerClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: HTTPServerClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPServerPrototype__closeIdleConnections(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPServerPrototype__closeIdleConnections") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPServerPrototype__dispose(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPServerPrototype__dispose") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPServerPrototype__doFetch(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPServerPrototype__doFetch") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPServerPrototype__doPublish(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPServerPrototype__doPublish") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPServerPrototype__doRef(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPServerPrototype__doRef") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPServerPrototype__doReload(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPServerPrototype__doReload") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPServerPrototype__doRequestIP(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPServerPrototype__doRequestIP") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPServerPrototype__doStop(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPServerPrototype__doStop") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPServerPrototype__doSubscriberCount(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPServerPrototype__doSubscriberCount") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPServerPrototype__doTimeout(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPServerPrototype__doTimeout") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPServerPrototype__doUnref(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPServerPrototype__doUnref") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPServerPrototype__doUpgrade(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPServerPrototype__doUpgrade") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPServerPrototype__getAddress(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPServerPrototype__getAddress") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPServerPrototype__getDevelopment(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPServerPrototype__getDevelopment") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPServerPrototype__getHostname(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPServerPrototype__getHostname") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPServerPrototype__getId(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPServerPrototype__getId") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPServerPrototype__getPendingRequests(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPServerPrototype__getPendingRequests") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPServerPrototype__getPendingWebSockets(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPServerPrototype__getPendingWebSockets") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPServerPrototype__getPort(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPServerPrototype__getPort") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPServerPrototype__getProtocol(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPServerPrototype__getProtocol") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPServerPrototype__getURL(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: HTTPServerPrototype__getURL") }
#[unsafe(no_mangle)] pub extern "C" fn HTTPServer__memoryCost(_p: *mut c_void) -> usize { unreachable!("codegen stub: HTTPServer__memoryCost") }
#[unsafe(no_mangle)] pub extern "C" fn ImageClass__clipboardChangeCount(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImageClass__clipboardChangeCount") }
#[unsafe(no_mangle)] pub extern "C" fn ImageClass__fromClipboard(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImageClass__fromClipboard") }
#[unsafe(no_mangle)] pub extern "C" fn ImageClass__getBackend(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImageClass__getBackend") }
#[unsafe(no_mangle)] pub extern "C" fn ImageClass__hasClipboardImage(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImageClass__hasClipboardImage") }
#[unsafe(no_mangle)] pub extern "C" fn ImageClass__setBackend(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImageClass__setBackend") }
#[unsafe(no_mangle)] pub extern "C" fn ImagePrototype__doBlob(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImagePrototype__doBlob") }
#[unsafe(no_mangle)] pub extern "C" fn ImagePrototype__doBuffer(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImagePrototype__doBuffer") }
#[unsafe(no_mangle)] pub extern "C" fn ImagePrototype__doBytes(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImagePrototype__doBytes") }
#[unsafe(no_mangle)] pub extern "C" fn ImagePrototype__doDataUrl(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImagePrototype__doDataUrl") }
#[unsafe(no_mangle)] pub extern "C" fn ImagePrototype__doFlip(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImagePrototype__doFlip") }
#[unsafe(no_mangle)] pub extern "C" fn ImagePrototype__doFlop(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImagePrototype__doFlop") }
#[unsafe(no_mangle)] pub extern "C" fn ImagePrototype__doFormatAvif(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImagePrototype__doFormatAvif") }
#[unsafe(no_mangle)] pub extern "C" fn ImagePrototype__doFormatHeic(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImagePrototype__doFormatHeic") }
#[unsafe(no_mangle)] pub extern "C" fn ImagePrototype__doFormatJpeg(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImagePrototype__doFormatJpeg") }
#[unsafe(no_mangle)] pub extern "C" fn ImagePrototype__doFormatPng(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImagePrototype__doFormatPng") }
#[unsafe(no_mangle)] pub extern "C" fn ImagePrototype__doFormatWebp(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImagePrototype__doFormatWebp") }
#[unsafe(no_mangle)] pub extern "C" fn ImagePrototype__doMetadata(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImagePrototype__doMetadata") }
#[unsafe(no_mangle)] pub extern "C" fn ImagePrototype__doModulate(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImagePrototype__doModulate") }
#[unsafe(no_mangle)] pub extern "C" fn ImagePrototype__doPlaceholder(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImagePrototype__doPlaceholder") }
#[unsafe(no_mangle)] pub extern "C" fn ImagePrototype__doResize(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImagePrototype__doResize") }
#[unsafe(no_mangle)] pub extern "C" fn ImagePrototype__doRotate(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImagePrototype__doRotate") }
#[unsafe(no_mangle)] pub extern "C" fn ImagePrototype__doToBase64(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImagePrototype__doToBase64") }
#[unsafe(no_mangle)] pub extern "C" fn ImagePrototype__doWrite(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImagePrototype__doWrite") }
#[unsafe(no_mangle)] pub extern "C" fn ImagePrototype__getHeight(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImagePrototype__getHeight") }
#[unsafe(no_mangle)] pub extern "C" fn ImagePrototype__getWidth(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImagePrototype__getWidth") }
#[unsafe(no_mangle)] pub extern "C" fn Image__estimatedSize(_p: *mut c_void) -> usize { unreachable!("codegen stub: Image__estimatedSize") }
#[unsafe(no_mangle)] pub extern "C" fn ImmediateClass__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!("codegen stub: ImmediateClass__construct") }
#[unsafe(no_mangle)] pub extern "C" fn ImmediateClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: ImmediateClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn ImmediatePrototype__dispose(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImmediatePrototype__dispose") }
#[unsafe(no_mangle)] pub extern "C" fn ImmediatePrototype__doRef(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImmediatePrototype__doRef") }
#[unsafe(no_mangle)] pub extern "C" fn ImmediatePrototype__doUnref(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImmediatePrototype__doUnref") }
#[unsafe(no_mangle)] pub extern "C" fn ImmediatePrototype__getDestroyed(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImmediatePrototype__getDestroyed") }
#[unsafe(no_mangle)] pub extern "C" fn ImmediatePrototype__hasRef(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImmediatePrototype__hasRef") }
#[unsafe(no_mangle)] pub extern "C" fn ImmediatePrototype__toPrimitive(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ImmediatePrototype__toPrimitive") }
#[unsafe(no_mangle)] pub static Immediate__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_bun_zig__getUseSystemCA(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_bun_zig__getUseSystemCA") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_crash_handler_crash_handler_zig__js_bindings_generate_workaround(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_crash_handler_crash_handler_zig__js_bindings_generate_workaround") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_css_jsc_css_internals_zig___test(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_css_jsc_css_internals_zig___test") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_css_jsc_css_internals_zig__attrTest(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_css_jsc_css_internals_zig__attrTest") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_css_jsc_css_internals_zig__minifyErrorTestWithOptions(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_css_jsc_css_internals_zig__minifyErrorTestWithOptions") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_css_jsc_css_internals_zig__minifyTest(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_css_jsc_css_internals_zig__minifyTest") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_css_jsc_css_internals_zig__minifyTestWithOptions(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_css_jsc_css_internals_zig__minifyTestWithOptions") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_css_jsc_css_internals_zig__prefixTest(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_css_jsc_css_internals_zig__prefixTest") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_css_jsc_css_internals_zig__prefixTestWithOptions(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_css_jsc_css_internals_zig__prefixTestWithOptions") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_css_jsc_css_internals_zig__testWithOptions(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_css_jsc_css_internals_zig__testWithOptions") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_http_H_Client_zig__TestingAPIs_liveCounts(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_http_H_Client_zig__TestingAPIs_liveCounts") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_http_H_Client_zig__TestingAPIs_quicLiveCounts(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_http_H_Client_zig__TestingAPIs_quicLiveCounts") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_ini_ini_zig__IniTestingAPIs_loadNpmrcFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_ini_ini_zig__IniTestingAPIs_loadNpmrcFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_ini_ini_zig__IniTestingAPIs_parse(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_ini_ini_zig__IniTestingAPIs_parse") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_install_dependency_zig__Version_Tag_inferFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_install_dependency_zig__Version_Tag_inferFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_install_dependency_zig__fromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_install_dependency_zig__fromJS") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_install_hosted_git_info_zig__TestingAPIs_jsFromUrl(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_install_hosted_git_info_zig__TestingAPIs_jsFromUrl") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_install_hosted_git_info_zig__TestingAPIs_jsParseUrl(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_install_hosted_git_info_zig__TestingAPIs_jsParseUrl") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_install_jsc_install_binding_zig__bun_install_js_bindings_generate_workaround(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_install_jsc_install_binding_zig__bun_install_js_bindings_generate_workaround") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_install_npm_zig__Architecture_jsFunctionArchitectureIsMatch(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_install_npm_zig__Architecture_jsFunctionArchitectureIsMatch") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_install_npm_zig__OperatingSystem_jsFunctionOperatingSystemIsMatch(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_install_npm_zig__OperatingSystem_jsFunctionOperatingSystemIsMatch") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_install_npm_zig__PackageManifest_bindings_generate_workaround(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_install_npm_zig__PackageManifest_bindings_generate_workaround") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_jsc_Counters_zig__createCountersObject(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_jsc_Counters_zig__createCountersObject") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_jsc_bindgen_test_zig__getBindgenTestFunctions_workaround(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_jsc_bindgen_test_zig__getBindgenTestFunctions_workaround") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_jsc_event_loop_zig__getActiveTasks(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_jsc_event_loop_zig__getActiveTasks") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_jsc_ipc_zig__emitHandleIPCMessage(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_jsc_ipc_zig__emitHandleIPCMessage") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_jsc_virtual_machine_exports_zig__Bun__setSyntheticAllocationLimitForTesting(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_jsc_virtual_machine_exports_zig__Bun__setSyntheticAllocationLimitForTesting") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_patch_patch_zig__TestingAPIs_apply(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_patch_patch_zig__TestingAPIs_apply") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_patch_patch_zig__TestingAPIs_makeDiff(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_patch_patch_zig__TestingAPIs_makeDiff") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_patch_patch_zig__TestingAPIs_parse(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_patch_patch_zig__TestingAPIs_parse") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_api_bun_SecureContext_zig__jsLiveCount(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_api_bun_SecureContext_zig__jsLiveCount") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_api_bun_SecureContext_zig__js_getConstructor_workaround(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_api_bun_SecureContext_zig__js_getConstructor_workaround") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_api_bun_h__frame_parser_zig__H_FrameParserConstructor_workaround(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_api_bun_h__frame_parser_zig__H_FrameParserConstructor_workaround") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_api_bun_h__frame_parser_zig__jsAssertSettings(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_api_bun_h__frame_parser_zig__jsAssertSettings") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_api_bun_subprocess_zig__TestingAPIs_injectStdioReadError(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_api_bun_subprocess_zig__TestingAPIs_injectStdioReadError") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_bake_FrameworkRouter_zig__JSFrameworkRouter_getBindings_workaround(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_bake_FrameworkRouter_zig__JSFrameworkRouter_getBindings_workaround") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_cli_pack_command_zig__bindings_jsReadTarball(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_cli_pack_command_zig__bindings_jsReadTarball") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_cli_upgrade_command_zig__upgrade_js_bindings_generate_workaround(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_cli_upgrade_command_zig__upgrade_js_bindings_generate_workaround") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_ffi_ffi_zig__Bun__FFI__cc(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_ffi_ffi_zig__Bun__FFI__cc") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_Stat_zig__createStatsForIno(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_Stat_zig__createStatsForIno") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_assert_binding_zig__generate_workaround(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_assert_binding_zig__generate_workaround") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_cluster_binding_zig__channelIgnoreOneDisconnectEventListener(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_cluster_binding_zig__channelIgnoreOneDisconnectEventListener") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_cluster_binding_zig__onInternalMessageChild(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_cluster_binding_zig__onInternalMessageChild") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_cluster_binding_zig__onInternalMessagePrimary(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_cluster_binding_zig__onInternalMessagePrimary") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_cluster_binding_zig__sendHelperChild(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_cluster_binding_zig__sendHelperChild") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_cluster_binding_zig__sendHelperPrimary(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_cluster_binding_zig__sendHelperPrimary") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_cluster_binding_zig__setRef(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_cluster_binding_zig__setRef") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_crypto_binding_zig__createNodeCryptoBindingZig_workaround(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_crypto_binding_zig__createNodeCryptoBindingZig_workaround") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_fs_binding_zig__createBinding_workaround(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_fs_binding_zig__createBinding_workaround") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_fs_binding_zig__createMemfdForTesting(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_fs_binding_zig__createMemfdForTesting") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_http_binding_zig__getBunServerAllClosedPromise(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_http_binding_zig__getBunServerAllClosedPromise") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_http_binding_zig__getMaxHTTPHeaderSize(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_http_binding_zig__getMaxHTTPHeaderSize") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_http_binding_zig__setMaxHTTPHeaderSize(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_http_binding_zig__setMaxHTTPHeaderSize") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_net_binding_zig__BlockList_workaround(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_net_binding_zig__BlockList_workaround") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_net_binding_zig__SocketAddress_workaround(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_net_binding_zig__SocketAddress_workaround") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_net_binding_zig__doConnect(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_net_binding_zig__doConnect") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_net_binding_zig__getDefaultAutoSelectFamilyAttemptTimeout_workaround(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_net_binding_zig__getDefaultAutoSelectFamilyAttemptTimeout_workaround") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_net_binding_zig__getDefaultAutoSelectFamily_workaround(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_net_binding_zig__getDefaultAutoSelectFamily_workaround") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_net_binding_zig__newDetachedSocket(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_net_binding_zig__newDetachedSocket") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_net_binding_zig__setDefaultAutoSelectFamilyAttemptTimeout_workaround(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_net_binding_zig__setDefaultAutoSelectFamilyAttemptTimeout_workaround") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_net_binding_zig__setDefaultAutoSelectFamily_workaround(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_net_binding_zig__setDefaultAutoSelectFamily_workaround") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_os_zig__createNodeOsBinding_workaround(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_os_zig__createNodeOsBinding_workaround") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_util_binding_zig__enobufsErrorCode(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_util_binding_zig__enobufsErrorCode") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_util_binding_zig__etimedoutErrorCode(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_util_binding_zig__etimedoutErrorCode") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_util_binding_zig__extractedSplitNewLinesFastPathStringsOnly(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_util_binding_zig__extractedSplitNewLinesFastPathStringsOnly") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_util_binding_zig__internalErrorName(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_util_binding_zig__internalErrorName") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_util_binding_zig__normalizeEncoding(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_util_binding_zig__normalizeEncoding") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_util_binding_zig__parseEnv(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_util_binding_zig__parseEnv") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_zlib_binding_zig__NativeBrotli_workaround(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_zlib_binding_zig__NativeBrotli_workaround") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_zlib_binding_zig__NativeZlib_workaround(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_zlib_binding_zig__NativeZlib_workaround") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_zlib_binding_zig__NativeZstd_workaround(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_zlib_binding_zig__NativeZstd_workaround") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_node_zlib_binding_zig__crc__(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_node_zlib_binding_zig__crc__") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_types_zig__jsAssertEncodingValid(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_types_zig__jsAssertEncodingValid") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_node_util_parse_args_zig__parseArgs(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_node_util_parse_args_zig__parseArgs") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_shell_shell_zig__TestingAPIs_disabledOnThisPlatform(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_shell_shell_zig__TestingAPIs_disabledOnThisPlatform") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_shell_shell_zig__TestingAPIs_shellLex(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_shell_shell_zig__TestingAPIs_shellLex") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_shell_shell_zig__TestingAPIs_shellParse(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_shell_shell_zig__TestingAPIs_shellParse") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_socket_Listener_zig__jsAddServerName(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_socket_Listener_zig__jsAddServerName") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_socket_socket_zig__jsCreateSocketPair(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_socket_socket_zig__jsCreateSocketPair") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_socket_socket_zig__jsGetBufferedAmount(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_socket_socket_zig__jsGetBufferedAmount") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_socket_socket_zig__jsIsNamedPipeSocket(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_socket_socket_zig__jsIsNamedPipeSocket") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_socket_socket_zig__jsSetSocketOptions(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_socket_socket_zig__jsSetSocketOptions") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_socket_socket_zig__jsUpgradeDuplexToTLS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_socket_socket_zig__jsUpgradeDuplexToTLS") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_socket_udp_socket_zig__UDPSocket_jsConnect(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_socket_udp_socket_zig__UDPSocket_jsConnect") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_socket_udp_socket_zig__UDPSocket_jsDisconnect(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_socket_udp_socket_zig__UDPSocket_jsDisconnect") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_timer_Timer_zig__internal_bindings_timerClockMs(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_timer_Timer_zig__internal_bindings_timerClockMs") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_webcore_FileSink_zig__TestingAPIs_fileSinkLiveCount(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_webcore_FileSink_zig__TestingAPIs_fileSinkLiveCount") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_runtime_webcore_fetch_zig__nodeHttpClient(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_runtime_webcore_fetch_zig__nodeHttpClient") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_sourcemap_InternalSourceMap_zig__TestingAPIs_find(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_sourcemap_InternalSourceMap_zig__TestingAPIs_find") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_sourcemap_InternalSourceMap_zig__TestingAPIs_fromVLQ(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_sourcemap_InternalSourceMap_zig__TestingAPIs_fromVLQ") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_sourcemap_InternalSourceMap_zig__TestingAPIs_toVLQ(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_sourcemap_InternalSourceMap_zig__TestingAPIs_toVLQ") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_sql_jsc_mysql_zig__createBinding_workaround(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_sql_jsc_mysql_zig__createBinding_workaround") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_sql_jsc_postgres_zig__createBinding_workaround(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_sql_jsc_postgres_zig__createBinding_workaround") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_string_escapeRegExp_zig__jsEscapeRegExp(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_string_escapeRegExp_zig__jsEscapeRegExp") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_string_escapeRegExp_zig__jsEscapeRegExpForPackageNameMatching(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_string_escapeRegExp_zig__jsEscapeRegExpForPackageNameMatching") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_string_immutable_unicode_zig__TestingAPIs_toUTF__AllocSentinel(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_string_immutable_unicode_zig__TestingAPIs_toUTF__AllocSentinel") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_string_string_zig__String_jsGetStringWidth(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_string_string_zig__String_jsGetStringWidth") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_sys_Error_zig__TestingAPIs_sysErrorNameFromLibuv(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_sys_Error_zig__TestingAPIs_sysErrorNameFromLibuv") }
#[unsafe(no_mangle)] pub extern "C" fn JS2Zig___src_sys_sys_zig__TestingAPIs_translateUVErrorToE(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: JS2Zig___src_sys_sys_zig__TestingAPIs_translateUVErrorToE") }
#[unsafe(no_mangle)] pub extern "C" fn ListenerPrototype__dispose(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ListenerPrototype__dispose") }
#[unsafe(no_mangle)] pub extern "C" fn ListenerPrototype__getData(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ListenerPrototype__getData") }
#[unsafe(no_mangle)] pub extern "C" fn ListenerPrototype__getFD(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ListenerPrototype__getFD") }
#[unsafe(no_mangle)] pub extern "C" fn ListenerPrototype__getHostname(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ListenerPrototype__getHostname") }
#[unsafe(no_mangle)] pub extern "C" fn ListenerPrototype__getPort(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ListenerPrototype__getPort") }
#[unsafe(no_mangle)] pub extern "C" fn ListenerPrototype__getUnix(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ListenerPrototype__getUnix") }
#[unsafe(no_mangle)] pub extern "C" fn ListenerPrototype__getsockname(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ListenerPrototype__getsockname") }
#[unsafe(no_mangle)] pub extern "C" fn ListenerPrototype__ref(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ListenerPrototype__ref") }
#[unsafe(no_mangle)] pub extern "C" fn ListenerPrototype__reload(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ListenerPrototype__reload") }
#[unsafe(no_mangle)] pub extern "C" fn ListenerPrototype__setData(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ListenerPrototype__setData") }
#[unsafe(no_mangle)] pub extern "C" fn ListenerPrototype__stop(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ListenerPrototype__stop") }
#[unsafe(no_mangle)] pub extern "C" fn ListenerPrototype__unref(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ListenerPrototype__unref") }
#[unsafe(no_mangle)] pub static Listener__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn MD4Class__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!("codegen stub: MD4Class__construct") }
#[unsafe(no_mangle)] pub extern "C" fn MD4Class__finalize(_p: *mut c_void) { unreachable!("codegen stub: MD4Class__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn MD4Class__getByteLengthStatic(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MD4Class__getByteLengthStatic") }
#[unsafe(no_mangle)] pub extern "C" fn MD4Class__hash(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MD4Class__hash") }
#[unsafe(no_mangle)] pub extern "C" fn MD4Prototype__digest(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MD4Prototype__digest") }
#[unsafe(no_mangle)] pub extern "C" fn MD4Prototype__getByteLength(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MD4Prototype__getByteLength") }
#[unsafe(no_mangle)] pub extern "C" fn MD4Prototype__update(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MD4Prototype__update") }
#[unsafe(no_mangle)] pub static MD4__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn MD5Class__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!("codegen stub: MD5Class__construct") }
#[unsafe(no_mangle)] pub extern "C" fn MD5Class__finalize(_p: *mut c_void) { unreachable!("codegen stub: MD5Class__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn MD5Class__getByteLengthStatic(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MD5Class__getByteLengthStatic") }
#[unsafe(no_mangle)] pub extern "C" fn MD5Class__hash(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MD5Class__hash") }
#[unsafe(no_mangle)] pub extern "C" fn MD5Prototype__digest(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MD5Prototype__digest") }
#[unsafe(no_mangle)] pub extern "C" fn MD5Prototype__getByteLength(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MD5Prototype__getByteLength") }
#[unsafe(no_mangle)] pub extern "C" fn MD5Prototype__update(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MD5Prototype__update") }
#[unsafe(no_mangle)] pub static MD5__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn MatchedRoutePrototype__getFilePath(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MatchedRoutePrototype__getFilePath") }
#[unsafe(no_mangle)] pub extern "C" fn MatchedRoutePrototype__getKind(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MatchedRoutePrototype__getKind") }
#[unsafe(no_mangle)] pub extern "C" fn MatchedRoutePrototype__getName(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MatchedRoutePrototype__getName") }
#[unsafe(no_mangle)] pub extern "C" fn MatchedRoutePrototype__getParams(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MatchedRoutePrototype__getParams") }
#[unsafe(no_mangle)] pub extern "C" fn MatchedRoutePrototype__getPathname(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MatchedRoutePrototype__getPathname") }
#[unsafe(no_mangle)] pub extern "C" fn MatchedRoutePrototype__getQuery(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MatchedRoutePrototype__getQuery") }
#[unsafe(no_mangle)] pub extern "C" fn MatchedRoutePrototype__getScriptSrc(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MatchedRoutePrototype__getScriptSrc") }
#[unsafe(no_mangle)] pub static MatchedRoute__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn MySQLConnectionClass__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!("codegen stub: MySQLConnectionClass__construct") }
#[unsafe(no_mangle)] pub extern "C" fn MySQLConnectionClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: MySQLConnectionClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn MySQLConnectionPrototype__doClose(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MySQLConnectionPrototype__doClose") }
#[unsafe(no_mangle)] pub extern "C" fn MySQLConnectionPrototype__doFlush(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MySQLConnectionPrototype__doFlush") }
#[unsafe(no_mangle)] pub extern "C" fn MySQLConnectionPrototype__doRef(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MySQLConnectionPrototype__doRef") }
#[unsafe(no_mangle)] pub extern "C" fn MySQLConnectionPrototype__doUnref(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MySQLConnectionPrototype__doUnref") }
#[unsafe(no_mangle)] pub extern "C" fn MySQLConnectionPrototype__getConnected(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MySQLConnectionPrototype__getConnected") }
#[unsafe(no_mangle)] pub extern "C" fn MySQLConnectionPrototype__getOnClose(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MySQLConnectionPrototype__getOnClose") }
#[unsafe(no_mangle)] pub extern "C" fn MySQLConnectionPrototype__getOnConnect(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MySQLConnectionPrototype__getOnConnect") }
#[unsafe(no_mangle)] pub extern "C" fn MySQLConnectionPrototype__getQueries(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MySQLConnectionPrototype__getQueries") }
#[unsafe(no_mangle)] pub extern "C" fn MySQLConnectionPrototype__setOnClose(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MySQLConnectionPrototype__setOnClose") }
#[unsafe(no_mangle)] pub extern "C" fn MySQLConnectionPrototype__setOnConnect(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MySQLConnectionPrototype__setOnConnect") }
#[unsafe(no_mangle)] pub static MySQLConnection__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn MySQLQueryClass__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!("codegen stub: MySQLQueryClass__construct") }
#[unsafe(no_mangle)] pub extern "C" fn MySQLQueryClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: MySQLQueryClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn MySQLQueryPrototype__doCancel(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MySQLQueryPrototype__doCancel") }
#[unsafe(no_mangle)] pub extern "C" fn MySQLQueryPrototype__doDone(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MySQLQueryPrototype__doDone") }
#[unsafe(no_mangle)] pub extern "C" fn MySQLQueryPrototype__doRun(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MySQLQueryPrototype__doRun") }
#[unsafe(no_mangle)] pub extern "C" fn MySQLQueryPrototype__setModeFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MySQLQueryPrototype__setModeFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn MySQLQueryPrototype__setPendingValueFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: MySQLQueryPrototype__setPendingValueFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn MySQLQuery__estimatedSize(_p: *mut c_void) -> usize { unreachable!("codegen stub: MySQLQuery__estimatedSize") }
#[unsafe(no_mangle)] pub extern "C" fn NativeBrotliPrototype__close(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NativeBrotliPrototype__close") }
#[unsafe(no_mangle)] pub extern "C" fn NativeBrotliPrototype__getOnError(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NativeBrotliPrototype__getOnError") }
#[unsafe(no_mangle)] pub extern "C" fn NativeBrotliPrototype__init(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NativeBrotliPrototype__init") }
#[unsafe(no_mangle)] pub extern "C" fn NativeBrotliPrototype__params(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NativeBrotliPrototype__params") }
#[unsafe(no_mangle)] pub extern "C" fn NativeBrotliPrototype__reset(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NativeBrotliPrototype__reset") }
#[unsafe(no_mangle)] pub extern "C" fn NativeBrotliPrototype__setOnError(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NativeBrotliPrototype__setOnError") }
#[unsafe(no_mangle)] pub extern "C" fn NativeBrotliPrototype__write(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NativeBrotliPrototype__write") }
#[unsafe(no_mangle)] pub extern "C" fn NativeBrotliPrototype__writeSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NativeBrotliPrototype__writeSync") }
#[unsafe(no_mangle)] pub extern "C" fn NativeBrotli__estimatedSize(_p: *mut c_void) -> usize { unreachable!("codegen stub: NativeBrotli__estimatedSize") }
#[unsafe(no_mangle)] pub extern "C" fn NativeZlibPrototype__close(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NativeZlibPrototype__close") }
#[unsafe(no_mangle)] pub extern "C" fn NativeZlibPrototype__getOnError(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NativeZlibPrototype__getOnError") }
#[unsafe(no_mangle)] pub extern "C" fn NativeZlibPrototype__init(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NativeZlibPrototype__init") }
#[unsafe(no_mangle)] pub extern "C" fn NativeZlibPrototype__params(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NativeZlibPrototype__params") }
#[unsafe(no_mangle)] pub extern "C" fn NativeZlibPrototype__reset(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NativeZlibPrototype__reset") }
#[unsafe(no_mangle)] pub extern "C" fn NativeZlibPrototype__setOnError(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NativeZlibPrototype__setOnError") }
#[unsafe(no_mangle)] pub extern "C" fn NativeZlibPrototype__write(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NativeZlibPrototype__write") }
#[unsafe(no_mangle)] pub extern "C" fn NativeZlibPrototype__writeSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NativeZlibPrototype__writeSync") }
#[unsafe(no_mangle)] pub extern "C" fn NativeZlib__estimatedSize(_p: *mut c_void) -> usize { unreachable!("codegen stub: NativeZlib__estimatedSize") }
#[unsafe(no_mangle)] pub extern "C" fn NativeZstdPrototype__close(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NativeZstdPrototype__close") }
#[unsafe(no_mangle)] pub extern "C" fn NativeZstdPrototype__getOnError(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NativeZstdPrototype__getOnError") }
#[unsafe(no_mangle)] pub extern "C" fn NativeZstdPrototype__init(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NativeZstdPrototype__init") }
#[unsafe(no_mangle)] pub extern "C" fn NativeZstdPrototype__params(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NativeZstdPrototype__params") }
#[unsafe(no_mangle)] pub extern "C" fn NativeZstdPrototype__reset(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NativeZstdPrototype__reset") }
#[unsafe(no_mangle)] pub extern "C" fn NativeZstdPrototype__setOnError(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NativeZstdPrototype__setOnError") }
#[unsafe(no_mangle)] pub extern "C" fn NativeZstdPrototype__write(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NativeZstdPrototype__write") }
#[unsafe(no_mangle)] pub extern "C" fn NativeZstdPrototype__writeSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NativeZstdPrototype__writeSync") }
#[unsafe(no_mangle)] pub extern "C" fn NativeZstd__estimatedSize(_p: *mut c_void) -> usize { unreachable!("codegen stub: NativeZstd__estimatedSize") }
#[unsafe(no_mangle)] pub extern "C" fn NetworkSink__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NetworkSink__construct") }
#[unsafe(no_mangle)] pub extern "C" fn NetworkSink__end(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NetworkSink__end") }
#[unsafe(no_mangle)] pub extern "C" fn NetworkSink__flush(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NetworkSink__flush") }
#[unsafe(no_mangle)] pub extern "C" fn NetworkSink__getInternalFd(_p: *mut c_void) -> JSValue { unreachable!("codegen stub: NetworkSink__getInternalFd") }
#[unsafe(no_mangle)] pub extern "C" fn NetworkSink__memoryCost(_p: *mut c_void) -> usize { unreachable!("codegen stub: NetworkSink__memoryCost") }
#[unsafe(no_mangle)] pub extern "C" fn NetworkSink__start(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NetworkSink__start") }
#[unsafe(no_mangle)] pub extern "C" fn NetworkSink__write(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NetworkSink__write") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponseClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: NodeHTTPResponseClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__abort(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__abort") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__cork(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__cork") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__doPause(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__doPause") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__doResume(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__doResume") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__drainRequestBody(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__drainRequestBody") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__dumpRequestBody(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__dumpRequestBody") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__end(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__end") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__flushHeaders(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__flushHeaders") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__getAborted(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__getAborted") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__getBufferedAmount(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__getBufferedAmount") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__getBytesWritten(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__getBytesWritten") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__getEnded(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__getEnded") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__getFinished(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__getFinished") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__getFlags(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__getFlags") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__getHasBody(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__getHasBody") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__getHasCustomOnData(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__getHasCustomOnData") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__getOnAbort(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__getOnAbort") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__getOnData(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__getOnData") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__getOnWritable(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__getOnWritable") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__getUpgraded(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__getUpgraded") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__jsRef(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__jsRef") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__jsUnref(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__jsUnref") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__setHasCustomOnData(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__setHasCustomOnData") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__setOnAbort(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__setOnAbort") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__setOnData(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__setOnData") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__setOnWritable(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__setOnWritable") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__write(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__write") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__writeContinue(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__writeContinue") }
#[unsafe(no_mangle)] pub extern "C" fn NodeHTTPResponsePrototype__writeHead(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeHTTPResponsePrototype__writeHead") }
#[unsafe(no_mangle)] pub static NodeHTTPResponse__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: NodeJSFSClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__access(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__access") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__accessSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__accessSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__appendFile(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__appendFile") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__appendFileSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__appendFileSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__chmod(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__chmod") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__chmodSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__chmodSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__chown(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__chown") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__chownSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__chownSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__close(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__close") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__closeSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__closeSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__copyFile(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__copyFile") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__copyFileSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__copyFileSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__cp(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__cp") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__cpSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__cpSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__exists(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__exists") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__existsSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__existsSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__fchmod(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__fchmod") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__fchmodSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__fchmodSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__fchown(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__fchown") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__fchownSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__fchownSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__fdatasync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__fdatasync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__fdatasyncSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__fdatasyncSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__fstat(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__fstat") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__fstatSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__fstatSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__fsync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__fsync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__fsyncSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__fsyncSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__ftruncate(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__ftruncate") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__ftruncateSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__ftruncateSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__futimes(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__futimes") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__futimesSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__futimesSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__getDirent(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__getDirent") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__getStats(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__getStats") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__lchmod(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__lchmod") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__lchmodSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__lchmodSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__lchown(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__lchown") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__lchownSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__lchownSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__link(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__link") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__linkSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__linkSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__lstat(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__lstat") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__lstatSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__lstatSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__lutimes(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__lutimes") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__lutimesSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__lutimesSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__mkdir(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__mkdir") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__mkdirSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__mkdirSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__mkdtemp(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__mkdtemp") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__mkdtempSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__mkdtempSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__open(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__open") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__openSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__openSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__read(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__read") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__readFile(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__readFile") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__readFileSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__readFileSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__readSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__readSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__readdir(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__readdir") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__readdirSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__readdirSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__readlink(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__readlink") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__readlinkSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__readlinkSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__readv(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__readv") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__readvSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__readvSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__realpath(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__realpath") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__realpathNative(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__realpathNative") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__realpathNativeSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__realpathNativeSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__realpathSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__realpathSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__rename(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__rename") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__renameSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__renameSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__rm(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__rm") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__rmSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__rmSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__rmdir(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__rmdir") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__rmdirSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__rmdirSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__stat(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__stat") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__statSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__statSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__statfs(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__statfs") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__statfsSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__statfsSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__symlink(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__symlink") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__symlinkSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__symlinkSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__truncate(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__truncate") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__truncateSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__truncateSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__unlink(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__unlink") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__unlinkSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__unlinkSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__unwatchFile(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__unwatchFile") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__utimes(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__utimes") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__utimesSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__utimesSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__watch(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__watch") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__watchFile(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__watchFile") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__write(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__write") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__writeFile(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__writeFile") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__writeFileSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__writeFileSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__writeSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__writeSync") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__writev(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__writev") }
#[unsafe(no_mangle)] pub extern "C" fn NodeJSFSPrototype__writevSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: NodeJSFSPrototype__writevSync") }
#[unsafe(no_mangle)] pub static NodeJSFS__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn ParsedShellScriptClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: ParsedShellScriptClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn ParsedShellScriptPrototype__setCwd(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ParsedShellScriptPrototype__setCwd") }
#[unsafe(no_mangle)] pub extern "C" fn ParsedShellScriptPrototype__setEnv(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ParsedShellScriptPrototype__setEnv") }
#[unsafe(no_mangle)] pub extern "C" fn ParsedShellScriptPrototype__setQuiet(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ParsedShellScriptPrototype__setQuiet") }
#[unsafe(no_mangle)] pub extern "C" fn ParsedShellScript__estimatedSize(_p: *mut c_void) -> usize { unreachable!("codegen stub: ParsedShellScript__estimatedSize") }
#[unsafe(no_mangle)] pub extern "C" fn ParsedShellScript__memoryCost(_p: *mut c_void) -> usize { unreachable!("codegen stub: ParsedShellScript__memoryCost") }
#[unsafe(no_mangle)] pub extern "C" fn PostgresSQLConnectionClass__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!("codegen stub: PostgresSQLConnectionClass__construct") }
#[unsafe(no_mangle)] pub extern "C" fn PostgresSQLConnectionClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: PostgresSQLConnectionClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn PostgresSQLConnectionPrototype__doClose(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: PostgresSQLConnectionPrototype__doClose") }
#[unsafe(no_mangle)] pub extern "C" fn PostgresSQLConnectionPrototype__doFlush(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: PostgresSQLConnectionPrototype__doFlush") }
#[unsafe(no_mangle)] pub extern "C" fn PostgresSQLConnectionPrototype__doRef(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: PostgresSQLConnectionPrototype__doRef") }
#[unsafe(no_mangle)] pub extern "C" fn PostgresSQLConnectionPrototype__doUnref(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: PostgresSQLConnectionPrototype__doUnref") }
#[unsafe(no_mangle)] pub extern "C" fn PostgresSQLConnectionPrototype__getConnected(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: PostgresSQLConnectionPrototype__getConnected") }
#[unsafe(no_mangle)] pub extern "C" fn PostgresSQLConnectionPrototype__getOnClose(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: PostgresSQLConnectionPrototype__getOnClose") }
#[unsafe(no_mangle)] pub extern "C" fn PostgresSQLConnectionPrototype__getOnConnect(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: PostgresSQLConnectionPrototype__getOnConnect") }
#[unsafe(no_mangle)] pub extern "C" fn PostgresSQLConnectionPrototype__getQueries(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: PostgresSQLConnectionPrototype__getQueries") }
#[unsafe(no_mangle)] pub extern "C" fn PostgresSQLConnectionPrototype__setOnClose(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: PostgresSQLConnectionPrototype__setOnClose") }
#[unsafe(no_mangle)] pub extern "C" fn PostgresSQLConnectionPrototype__setOnConnect(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: PostgresSQLConnectionPrototype__setOnConnect") }
#[unsafe(no_mangle)] pub static PostgresSQLConnection__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn PostgresSQLConnection__hasPendingActivity(_p: *mut c_void) -> bool { unreachable!("codegen stub: PostgresSQLConnection__hasPendingActivity") }
#[unsafe(no_mangle)] pub extern "C" fn PostgresSQLQueryClass__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!("codegen stub: PostgresSQLQueryClass__construct") }
#[unsafe(no_mangle)] pub extern "C" fn PostgresSQLQueryClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: PostgresSQLQueryClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn PostgresSQLQueryPrototype__doCancel(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: PostgresSQLQueryPrototype__doCancel") }
#[unsafe(no_mangle)] pub extern "C" fn PostgresSQLQueryPrototype__doDone(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: PostgresSQLQueryPrototype__doDone") }
#[unsafe(no_mangle)] pub extern "C" fn PostgresSQLQueryPrototype__doRun(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: PostgresSQLQueryPrototype__doRun") }
#[unsafe(no_mangle)] pub extern "C" fn PostgresSQLQueryPrototype__setModeFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: PostgresSQLQueryPrototype__setModeFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn PostgresSQLQueryPrototype__setPendingValueFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: PostgresSQLQueryPrototype__setPendingValueFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn PostgresSQLQuery__estimatedSize(_p: *mut c_void) -> usize { unreachable!("codegen stub: PostgresSQLQuery__estimatedSize") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientClass__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!("codegen stub: RedisClientClass__construct") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: RedisClientClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__append(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__append") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__bitcount(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__bitcount") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__blmove(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__blmove") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__blmpop(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__blmpop") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__blpop(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__blpop") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__brpop(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__brpop") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__brpoplpush(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__brpoplpush") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__bzmpop(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__bzmpop") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__bzpopmax(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__bzpopmax") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__bzpopmin(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__bzpopmin") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__copy(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__copy") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__decr(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__decr") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__decrby(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__decrby") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__del(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__del") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__dump(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__dump") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__duplicate(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__duplicate") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__exists(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__exists") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__expire(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__expire") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__expireat(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__expireat") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__expiretime(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__expiretime") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__get(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__get") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__getBuffer(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__getBuffer") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__getBufferedAmount(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__getBufferedAmount") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__getConnected(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__getConnected") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__getOnClose(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__getOnClose") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__getOnConnect(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__getOnConnect") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__getbit(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__getbit") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__getdel(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__getdel") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__getex(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__getex") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__getrange(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__getrange") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__getset(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__getset") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__hdel(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__hdel") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__hexists(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__hexists") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__hexpire(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__hexpire") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__hexpireat(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__hexpireat") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__hexpiretime(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__hexpiretime") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__hget(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__hget") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__hgetall(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__hgetall") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__hgetdel(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__hgetdel") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__hgetex(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__hgetex") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__hincrby(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__hincrby") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__hincrbyfloat(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__hincrbyfloat") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__hkeys(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__hkeys") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__hlen(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__hlen") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__hmget(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__hmget") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__hmset(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__hmset") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__hpersist(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__hpersist") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__hpexpire(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__hpexpire") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__hpexpireat(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__hpexpireat") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__hpexpiretime(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__hpexpiretime") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__hpttl(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__hpttl") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__hrandfield(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__hrandfield") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__hscan(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__hscan") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__hset(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__hset") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__hsetex(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__hsetex") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__hsetnx(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__hsetnx") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__hstrlen(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__hstrlen") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__httl(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__httl") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__hvals(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__hvals") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__incr(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__incr") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__incrby(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__incrby") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__incrbyfloat(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__incrbyfloat") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__jsConnect(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__jsConnect") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__jsDisconnect(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__jsDisconnect") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__jsSend(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__jsSend") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__keys(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__keys") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__lindex(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__lindex") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__linsert(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__linsert") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__llen(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__llen") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__lmove(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__lmove") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__lmpop(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__lmpop") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__lpop(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__lpop") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__lpos(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__lpos") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__lpush(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__lpush") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__lpushx(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__lpushx") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__lrange(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__lrange") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__lrem(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__lrem") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__lset(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__lset") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__ltrim(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__ltrim") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__mget(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__mget") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__mset(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__mset") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__msetnx(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__msetnx") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__persist(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__persist") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__pexpire(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__pexpire") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__pexpireat(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__pexpireat") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__pexpiretime(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__pexpiretime") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__pfadd(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__pfadd") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__ping(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__ping") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__psetex(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__psetex") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__psubscribe(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__psubscribe") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__pttl(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__pttl") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__publish(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__publish") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__pubsub(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__pubsub") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__punsubscribe(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__punsubscribe") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__randomkey(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__randomkey") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__rename(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__rename") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__renamenx(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__renamenx") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__rpop(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__rpop") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__rpoplpush(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__rpoplpush") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__rpush(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__rpush") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__rpushx(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__rpushx") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__sadd(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__sadd") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__scan(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__scan") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__scard(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__scard") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__script(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__script") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__sdiff(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__sdiff") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__sdiffstore(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__sdiffstore") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__select(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__select") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__set(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__set") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__setOnClose(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__setOnClose") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__setOnConnect(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__setOnConnect") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__setbit(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__setbit") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__setex(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__setex") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__setnx(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__setnx") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__setrange(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__setrange") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__sinter(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__sinter") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__sintercard(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__sintercard") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__sinterstore(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__sinterstore") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__sismember(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__sismember") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__smembers(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__smembers") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__smismember(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__smismember") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__smove(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__smove") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__spop(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__spop") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__spublish(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__spublish") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__srandmember(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__srandmember") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__srem(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__srem") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__sscan(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__sscan") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__strlen(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__strlen") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__subscribe(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__subscribe") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__substr(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__substr") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__sunion(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__sunion") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__sunionstore(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__sunionstore") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__touch(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__touch") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__ttl(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__ttl") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__type(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__type") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__unlink(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__unlink") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__unsubscribe(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__unsubscribe") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zadd(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zadd") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zcard(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zcard") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zcount(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zcount") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zdiff(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zdiff") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zdiffstore(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zdiffstore") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zincrby(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zincrby") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zinter(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zinter") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zintercard(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zintercard") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zinterstore(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zinterstore") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zlexcount(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zlexcount") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zmpop(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zmpop") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zmscore(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zmscore") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zpopmax(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zpopmax") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zpopmin(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zpopmin") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zrandmember(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zrandmember") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zrange(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zrange") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zrangebylex(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zrangebylex") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zrangebyscore(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zrangebyscore") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zrangestore(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zrangestore") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zrank(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zrank") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zrem(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zrem") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zremrangebylex(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zremrangebylex") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zremrangebyrank(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zremrangebyrank") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zremrangebyscore(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zremrangebyscore") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zrevrange(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zrevrange") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zrevrangebylex(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zrevrangebylex") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zrevrangebyscore(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zrevrangebyscore") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zrevrank(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zrevrank") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zscan(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zscan") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zscore(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zscore") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zunion(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zunion") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClientPrototype__zunionstore(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RedisClientPrototype__zunionstore") }
#[unsafe(no_mangle)] pub extern "C" fn RedisClient__memoryCost(_p: *mut c_void) -> usize { unreachable!("codegen stub: RedisClient__memoryCost") }
#[unsafe(no_mangle)] pub extern "C" fn RequestClass__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!("codegen stub: RequestClass__construct") }
#[unsafe(no_mangle)] pub extern "C" fn RequestClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: RequestClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn RequestPrototype__doClone(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RequestPrototype__doClone") }
#[unsafe(no_mangle)] pub extern "C" fn RequestPrototype__getArrayBuffer(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RequestPrototype__getArrayBuffer") }
#[unsafe(no_mangle)] pub extern "C" fn RequestPrototype__getBlob(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RequestPrototype__getBlob") }
#[unsafe(no_mangle)] pub extern "C" fn RequestPrototype__getBody(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RequestPrototype__getBody") }
#[unsafe(no_mangle)] pub extern "C" fn RequestPrototype__getBodyUsed(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RequestPrototype__getBodyUsed") }
#[unsafe(no_mangle)] pub extern "C" fn RequestPrototype__getBytes(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RequestPrototype__getBytes") }
#[unsafe(no_mangle)] pub extern "C" fn RequestPrototype__getCache(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RequestPrototype__getCache") }
#[unsafe(no_mangle)] pub extern "C" fn RequestPrototype__getCredentials(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RequestPrototype__getCredentials") }
#[unsafe(no_mangle)] pub extern "C" fn RequestPrototype__getDestination(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RequestPrototype__getDestination") }
#[unsafe(no_mangle)] pub extern "C" fn RequestPrototype__getFormData(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RequestPrototype__getFormData") }
#[unsafe(no_mangle)] pub extern "C" fn RequestPrototype__getHeaders(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RequestPrototype__getHeaders") }
#[unsafe(no_mangle)] pub extern "C" fn RequestPrototype__getIntegrity(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RequestPrototype__getIntegrity") }
#[unsafe(no_mangle)] pub extern "C" fn RequestPrototype__getJSON(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RequestPrototype__getJSON") }
#[unsafe(no_mangle)] pub extern "C" fn RequestPrototype__getMethod(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RequestPrototype__getMethod") }
#[unsafe(no_mangle)] pub extern "C" fn RequestPrototype__getMode(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RequestPrototype__getMode") }
#[unsafe(no_mangle)] pub extern "C" fn RequestPrototype__getRedirect(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RequestPrototype__getRedirect") }
#[unsafe(no_mangle)] pub extern "C" fn RequestPrototype__getReferrer(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RequestPrototype__getReferrer") }
#[unsafe(no_mangle)] pub extern "C" fn RequestPrototype__getReferrerPolicy(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RequestPrototype__getReferrerPolicy") }
#[unsafe(no_mangle)] pub extern "C" fn RequestPrototype__getSignal(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RequestPrototype__getSignal") }
#[unsafe(no_mangle)] pub extern "C" fn RequestPrototype__getText(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RequestPrototype__getText") }
#[unsafe(no_mangle)] pub extern "C" fn RequestPrototype__getUrl(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: RequestPrototype__getUrl") }
#[unsafe(no_mangle)] pub extern "C" fn Request__estimatedSize(_p: *mut c_void) -> usize { unreachable!("codegen stub: Request__estimatedSize") }
#[unsafe(no_mangle)] pub extern "C" fn Request__memoryCost(_p: *mut c_void) -> usize { unreachable!("codegen stub: Request__memoryCost") }
#[unsafe(no_mangle)] pub extern "C" fn ResolveMessagePrototype__getCode(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResolveMessagePrototype__getCode") }
#[unsafe(no_mangle)] pub extern "C" fn ResolveMessagePrototype__getColumn(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResolveMessagePrototype__getColumn") }
#[unsafe(no_mangle)] pub extern "C" fn ResolveMessagePrototype__getImportKind(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResolveMessagePrototype__getImportKind") }
#[unsafe(no_mangle)] pub extern "C" fn ResolveMessagePrototype__getLevel(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResolveMessagePrototype__getLevel") }
#[unsafe(no_mangle)] pub extern "C" fn ResolveMessagePrototype__getLine(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResolveMessagePrototype__getLine") }
#[unsafe(no_mangle)] pub extern "C" fn ResolveMessagePrototype__getMessage(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResolveMessagePrototype__getMessage") }
#[unsafe(no_mangle)] pub extern "C" fn ResolveMessagePrototype__getPosition(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResolveMessagePrototype__getPosition") }
#[unsafe(no_mangle)] pub extern "C" fn ResolveMessagePrototype__getReferrer(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResolveMessagePrototype__getReferrer") }
#[unsafe(no_mangle)] pub extern "C" fn ResolveMessagePrototype__getSpecifier(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResolveMessagePrototype__getSpecifier") }
#[unsafe(no_mangle)] pub extern "C" fn ResolveMessagePrototype__toJSON(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResolveMessagePrototype__toJSON") }
#[unsafe(no_mangle)] pub extern "C" fn ResolveMessagePrototype__toPrimitive(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResolveMessagePrototype__toPrimitive") }
#[unsafe(no_mangle)] pub extern "C" fn ResolveMessagePrototype__toString(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResolveMessagePrototype__toString") }
#[unsafe(no_mangle)] pub static ResolveMessage__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn ResourceUsagePrototype__getCPUTime(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResourceUsagePrototype__getCPUTime") }
#[unsafe(no_mangle)] pub extern "C" fn ResourceUsagePrototype__getContextSwitches(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResourceUsagePrototype__getContextSwitches") }
#[unsafe(no_mangle)] pub extern "C" fn ResourceUsagePrototype__getMaxRSS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResourceUsagePrototype__getMaxRSS") }
#[unsafe(no_mangle)] pub extern "C" fn ResourceUsagePrototype__getMessages(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResourceUsagePrototype__getMessages") }
#[unsafe(no_mangle)] pub extern "C" fn ResourceUsagePrototype__getOps(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResourceUsagePrototype__getOps") }
#[unsafe(no_mangle)] pub extern "C" fn ResourceUsagePrototype__getSharedMemorySize(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResourceUsagePrototype__getSharedMemorySize") }
#[unsafe(no_mangle)] pub extern "C" fn ResourceUsagePrototype__getSignalCount(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResourceUsagePrototype__getSignalCount") }
#[unsafe(no_mangle)] pub extern "C" fn ResourceUsagePrototype__getSwapCount(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResourceUsagePrototype__getSwapCount") }
#[unsafe(no_mangle)] pub static ResourceUsage__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn ResponseClass__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!("codegen stub: ResponseClass__construct") }
#[unsafe(no_mangle)] pub extern "C" fn ResponseClass__constructError(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResponseClass__constructError") }
#[unsafe(no_mangle)] pub extern "C" fn ResponseClass__constructJSON(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResponseClass__constructJSON") }
#[unsafe(no_mangle)] pub extern "C" fn ResponseClass__constructRedirect(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResponseClass__constructRedirect") }
#[unsafe(no_mangle)] pub extern "C" fn ResponseClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: ResponseClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn ResponsePrototype__doClone(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResponsePrototype__doClone") }
#[unsafe(no_mangle)] pub extern "C" fn ResponsePrototype__getArrayBuffer(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResponsePrototype__getArrayBuffer") }
#[unsafe(no_mangle)] pub extern "C" fn ResponsePrototype__getBlob(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResponsePrototype__getBlob") }
#[unsafe(no_mangle)] pub extern "C" fn ResponsePrototype__getBody(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResponsePrototype__getBody") }
#[unsafe(no_mangle)] pub extern "C" fn ResponsePrototype__getBodyUsed(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResponsePrototype__getBodyUsed") }
#[unsafe(no_mangle)] pub extern "C" fn ResponsePrototype__getBytes(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResponsePrototype__getBytes") }
#[unsafe(no_mangle)] pub extern "C" fn ResponsePrototype__getFormData(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResponsePrototype__getFormData") }
#[unsafe(no_mangle)] pub extern "C" fn ResponsePrototype__getHeaders(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResponsePrototype__getHeaders") }
#[unsafe(no_mangle)] pub extern "C" fn ResponsePrototype__getJSON(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResponsePrototype__getJSON") }
#[unsafe(no_mangle)] pub extern "C" fn ResponsePrototype__getOK(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResponsePrototype__getOK") }
#[unsafe(no_mangle)] pub extern "C" fn ResponsePrototype__getRedirected(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResponsePrototype__getRedirected") }
#[unsafe(no_mangle)] pub extern "C" fn ResponsePrototype__getResponseType(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResponsePrototype__getResponseType") }
#[unsafe(no_mangle)] pub extern "C" fn ResponsePrototype__getStatus(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResponsePrototype__getStatus") }
#[unsafe(no_mangle)] pub extern "C" fn ResponsePrototype__getStatusText(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResponsePrototype__getStatusText") }
#[unsafe(no_mangle)] pub extern "C" fn ResponsePrototype__getText(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResponsePrototype__getText") }
#[unsafe(no_mangle)] pub extern "C" fn ResponsePrototype__getURL(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResponsePrototype__getURL") }
#[unsafe(no_mangle)] pub extern "C" fn Response__estimatedSize(_p: *mut c_void) -> usize { unreachable!("codegen stub: Response__estimatedSize") }
#[unsafe(no_mangle)] pub extern "C" fn ResumableFetchSinkClass__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!("codegen stub: ResumableFetchSinkClass__construct") }
#[unsafe(no_mangle)] pub extern "C" fn ResumableFetchSinkClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: ResumableFetchSinkClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn ResumableFetchSinkPrototype__jsEnd(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResumableFetchSinkPrototype__jsEnd") }
#[unsafe(no_mangle)] pub extern "C" fn ResumableFetchSinkPrototype__jsSetHandlers(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResumableFetchSinkPrototype__jsSetHandlers") }
#[unsafe(no_mangle)] pub extern "C" fn ResumableFetchSinkPrototype__jsStart(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResumableFetchSinkPrototype__jsStart") }
#[unsafe(no_mangle)] pub extern "C" fn ResumableFetchSinkPrototype__jsWrite(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResumableFetchSinkPrototype__jsWrite") }
#[unsafe(no_mangle)] pub static ResumableFetchSink__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn ResumableS3UploadSinkClass__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!("codegen stub: ResumableS3UploadSinkClass__construct") }
#[unsafe(no_mangle)] pub extern "C" fn ResumableS3UploadSinkClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: ResumableS3UploadSinkClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn ResumableS3UploadSinkPrototype__jsEnd(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResumableS3UploadSinkPrototype__jsEnd") }
#[unsafe(no_mangle)] pub extern "C" fn ResumableS3UploadSinkPrototype__jsSetHandlers(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResumableS3UploadSinkPrototype__jsSetHandlers") }
#[unsafe(no_mangle)] pub extern "C" fn ResumableS3UploadSinkPrototype__jsStart(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResumableS3UploadSinkPrototype__jsStart") }
#[unsafe(no_mangle)] pub extern "C" fn ResumableS3UploadSinkPrototype__jsWrite(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ResumableS3UploadSinkPrototype__jsWrite") }
#[unsafe(no_mangle)] pub static ResumableS3UploadSink__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn S3ClientClass__staticExists(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: S3ClientClass__staticExists") }
#[unsafe(no_mangle)] pub extern "C" fn S3ClientClass__staticFile(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: S3ClientClass__staticFile") }
#[unsafe(no_mangle)] pub extern "C" fn S3ClientClass__staticListObjects(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: S3ClientClass__staticListObjects") }
#[unsafe(no_mangle)] pub extern "C" fn S3ClientClass__staticPresign(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: S3ClientClass__staticPresign") }
#[unsafe(no_mangle)] pub extern "C" fn S3ClientClass__staticSize(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: S3ClientClass__staticSize") }
#[unsafe(no_mangle)] pub extern "C" fn S3ClientClass__staticStat(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: S3ClientClass__staticStat") }
#[unsafe(no_mangle)] pub extern "C" fn S3ClientClass__staticUnlink(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: S3ClientClass__staticUnlink") }
#[unsafe(no_mangle)] pub extern "C" fn S3ClientClass__staticWrite(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: S3ClientClass__staticWrite") }
#[unsafe(no_mangle)] pub extern "C" fn S3ClientPrototype__exists(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: S3ClientPrototype__exists") }
#[unsafe(no_mangle)] pub extern "C" fn S3ClientPrototype__file(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: S3ClientPrototype__file") }
#[unsafe(no_mangle)] pub extern "C" fn S3ClientPrototype__listObjects(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: S3ClientPrototype__listObjects") }
#[unsafe(no_mangle)] pub extern "C" fn S3ClientPrototype__presign(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: S3ClientPrototype__presign") }
#[unsafe(no_mangle)] pub extern "C" fn S3ClientPrototype__size(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: S3ClientPrototype__size") }
#[unsafe(no_mangle)] pub extern "C" fn S3ClientPrototype__stat(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: S3ClientPrototype__stat") }
#[unsafe(no_mangle)] pub extern "C" fn S3ClientPrototype__unlink(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: S3ClientPrototype__unlink") }
#[unsafe(no_mangle)] pub extern "C" fn S3ClientPrototype__write(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: S3ClientPrototype__write") }
#[unsafe(no_mangle)] pub static S3Client__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn S3StatPrototype__getContentType(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: S3StatPrototype__getContentType") }
#[unsafe(no_mangle)] pub extern "C" fn S3StatPrototype__getEtag(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: S3StatPrototype__getEtag") }
#[unsafe(no_mangle)] pub extern "C" fn S3StatPrototype__getLastModified(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: S3StatPrototype__getLastModified") }
#[unsafe(no_mangle)] pub extern "C" fn S3StatPrototype__getSize(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: S3StatPrototype__getSize") }
#[unsafe(no_mangle)] pub static S3Stat__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn SHA1Class__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!("codegen stub: SHA1Class__construct") }
#[unsafe(no_mangle)] pub extern "C" fn SHA1Class__finalize(_p: *mut c_void) { unreachable!("codegen stub: SHA1Class__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn SHA1Class__getByteLengthStatic(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA1Class__getByteLengthStatic") }
#[unsafe(no_mangle)] pub extern "C" fn SHA1Class__hash(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA1Class__hash") }
#[unsafe(no_mangle)] pub extern "C" fn SHA1Prototype__digest(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA1Prototype__digest") }
#[unsafe(no_mangle)] pub extern "C" fn SHA1Prototype__getByteLength(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA1Prototype__getByteLength") }
#[unsafe(no_mangle)] pub extern "C" fn SHA1Prototype__update(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA1Prototype__update") }
#[unsafe(no_mangle)] pub static SHA1__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn SHA224Class__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!("codegen stub: SHA224Class__construct") }
#[unsafe(no_mangle)] pub extern "C" fn SHA224Class__finalize(_p: *mut c_void) { unreachable!("codegen stub: SHA224Class__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn SHA224Class__getByteLengthStatic(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA224Class__getByteLengthStatic") }
#[unsafe(no_mangle)] pub extern "C" fn SHA224Class__hash(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA224Class__hash") }
#[unsafe(no_mangle)] pub extern "C" fn SHA224Prototype__digest(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA224Prototype__digest") }
#[unsafe(no_mangle)] pub extern "C" fn SHA224Prototype__getByteLength(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA224Prototype__getByteLength") }
#[unsafe(no_mangle)] pub extern "C" fn SHA224Prototype__update(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA224Prototype__update") }
#[unsafe(no_mangle)] pub static SHA224__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn SHA256Class__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!("codegen stub: SHA256Class__construct") }
#[unsafe(no_mangle)] pub extern "C" fn SHA256Class__finalize(_p: *mut c_void) { unreachable!("codegen stub: SHA256Class__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn SHA256Class__getByteLengthStatic(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA256Class__getByteLengthStatic") }
#[unsafe(no_mangle)] pub extern "C" fn SHA256Class__hash(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA256Class__hash") }
#[unsafe(no_mangle)] pub extern "C" fn SHA256Prototype__digest(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA256Prototype__digest") }
#[unsafe(no_mangle)] pub extern "C" fn SHA256Prototype__getByteLength(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA256Prototype__getByteLength") }
#[unsafe(no_mangle)] pub extern "C" fn SHA256Prototype__update(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA256Prototype__update") }
#[unsafe(no_mangle)] pub static SHA256__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn SHA384Class__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!("codegen stub: SHA384Class__construct") }
#[unsafe(no_mangle)] pub extern "C" fn SHA384Class__finalize(_p: *mut c_void) { unreachable!("codegen stub: SHA384Class__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn SHA384Class__getByteLengthStatic(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA384Class__getByteLengthStatic") }
#[unsafe(no_mangle)] pub extern "C" fn SHA384Class__hash(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA384Class__hash") }
#[unsafe(no_mangle)] pub extern "C" fn SHA384Prototype__digest(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA384Prototype__digest") }
#[unsafe(no_mangle)] pub extern "C" fn SHA384Prototype__getByteLength(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA384Prototype__getByteLength") }
#[unsafe(no_mangle)] pub extern "C" fn SHA384Prototype__update(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA384Prototype__update") }
#[unsafe(no_mangle)] pub static SHA384__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn SHA512Class__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!("codegen stub: SHA512Class__construct") }
#[unsafe(no_mangle)] pub extern "C" fn SHA512Class__finalize(_p: *mut c_void) { unreachable!("codegen stub: SHA512Class__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn SHA512Class__getByteLengthStatic(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA512Class__getByteLengthStatic") }
#[unsafe(no_mangle)] pub extern "C" fn SHA512Class__hash(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA512Class__hash") }
#[unsafe(no_mangle)] pub extern "C" fn SHA512Prototype__digest(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA512Prototype__digest") }
#[unsafe(no_mangle)] pub extern "C" fn SHA512Prototype__getByteLength(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA512Prototype__getByteLength") }
#[unsafe(no_mangle)] pub extern "C" fn SHA512Prototype__update(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA512Prototype__update") }
#[unsafe(no_mangle)] pub extern "C" fn SHA512_256Class__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!("codegen stub: SHA512_256Class__construct") }
#[unsafe(no_mangle)] pub extern "C" fn SHA512_256Class__finalize(_p: *mut c_void) { unreachable!("codegen stub: SHA512_256Class__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn SHA512_256Class__getByteLengthStatic(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA512_256Class__getByteLengthStatic") }
#[unsafe(no_mangle)] pub extern "C" fn SHA512_256Class__hash(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA512_256Class__hash") }
#[unsafe(no_mangle)] pub extern "C" fn SHA512_256Prototype__digest(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA512_256Prototype__digest") }
#[unsafe(no_mangle)] pub extern "C" fn SHA512_256Prototype__getByteLength(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA512_256Prototype__getByteLength") }
#[unsafe(no_mangle)] pub extern "C" fn SHA512_256Prototype__update(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SHA512_256Prototype__update") }
#[unsafe(no_mangle)] pub static SHA512_256__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub static SHA512__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn ScopeFunctionsPrototype__fnConcurrentIf(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ScopeFunctionsPrototype__fnConcurrentIf") }
#[unsafe(no_mangle)] pub extern "C" fn ScopeFunctionsPrototype__fnEach(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ScopeFunctionsPrototype__fnEach") }
#[unsafe(no_mangle)] pub extern "C" fn ScopeFunctionsPrototype__fnFailingIf(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ScopeFunctionsPrototype__fnFailingIf") }
#[unsafe(no_mangle)] pub extern "C" fn ScopeFunctionsPrototype__fnIf(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ScopeFunctionsPrototype__fnIf") }
#[unsafe(no_mangle)] pub extern "C" fn ScopeFunctionsPrototype__fnSerialIf(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ScopeFunctionsPrototype__fnSerialIf") }
#[unsafe(no_mangle)] pub extern "C" fn ScopeFunctionsPrototype__fnSkipIf(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ScopeFunctionsPrototype__fnSkipIf") }
#[unsafe(no_mangle)] pub extern "C" fn ScopeFunctionsPrototype__fnTodoIf(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ScopeFunctionsPrototype__fnTodoIf") }
#[unsafe(no_mangle)] pub extern "C" fn ScopeFunctionsPrototype__getConcurrent(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ScopeFunctionsPrototype__getConcurrent") }
#[unsafe(no_mangle)] pub extern "C" fn ScopeFunctionsPrototype__getFailing(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ScopeFunctionsPrototype__getFailing") }
#[unsafe(no_mangle)] pub extern "C" fn ScopeFunctionsPrototype__getOnly(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ScopeFunctionsPrototype__getOnly") }
#[unsafe(no_mangle)] pub extern "C" fn ScopeFunctionsPrototype__getSerial(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ScopeFunctionsPrototype__getSerial") }
#[unsafe(no_mangle)] pub extern "C" fn ScopeFunctionsPrototype__getSkip(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ScopeFunctionsPrototype__getSkip") }
#[unsafe(no_mangle)] pub extern "C" fn ScopeFunctionsPrototype__getTodo(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ScopeFunctionsPrototype__getTodo") }
#[unsafe(no_mangle)] pub static ScopeFunctions__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn SecureContextClass__intern(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SecureContextClass__intern") }
#[unsafe(no_mangle)] pub extern "C" fn SecureContext__memoryCost(_p: *mut c_void) -> usize { unreachable!("codegen stub: SecureContext__memoryCost") }
#[unsafe(no_mangle)] pub extern "C" fn ServerWebSocketClass__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!("codegen stub: ServerWebSocketClass__construct") }
#[unsafe(no_mangle)] pub extern "C" fn ServerWebSocketClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: ServerWebSocketClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn ServerWebSocketPrototype__close(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ServerWebSocketPrototype__close") }
#[unsafe(no_mangle)] pub extern "C" fn ServerWebSocketPrototype__cork(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ServerWebSocketPrototype__cork") }
#[unsafe(no_mangle)] pub extern "C" fn ServerWebSocketPrototype__getBinaryType(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ServerWebSocketPrototype__getBinaryType") }
#[unsafe(no_mangle)] pub extern "C" fn ServerWebSocketPrototype__getBufferedAmount(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ServerWebSocketPrototype__getBufferedAmount") }
#[unsafe(no_mangle)] pub extern "C" fn ServerWebSocketPrototype__getData(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ServerWebSocketPrototype__getData") }
#[unsafe(no_mangle)] pub extern "C" fn ServerWebSocketPrototype__getReadyState(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ServerWebSocketPrototype__getReadyState") }
#[unsafe(no_mangle)] pub extern "C" fn ServerWebSocketPrototype__getRemoteAddress(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ServerWebSocketPrototype__getRemoteAddress") }
#[unsafe(no_mangle)] pub extern "C" fn ServerWebSocketPrototype__getSubscriptions(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ServerWebSocketPrototype__getSubscriptions") }
#[unsafe(no_mangle)] pub extern "C" fn ServerWebSocketPrototype__isSubscribed(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ServerWebSocketPrototype__isSubscribed") }
#[unsafe(no_mangle)] pub extern "C" fn ServerWebSocketPrototype__ping(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ServerWebSocketPrototype__ping") }
#[unsafe(no_mangle)] pub extern "C" fn ServerWebSocketPrototype__pong(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ServerWebSocketPrototype__pong") }
#[unsafe(no_mangle)] pub extern "C" fn ServerWebSocketPrototype__publish(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ServerWebSocketPrototype__publish") }
#[unsafe(no_mangle)] pub extern "C" fn ServerWebSocketPrototype__publishBinary(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ServerWebSocketPrototype__publishBinary") }
#[unsafe(no_mangle)] pub extern "C" fn ServerWebSocketPrototype__publishText(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ServerWebSocketPrototype__publishText") }
#[unsafe(no_mangle)] pub extern "C" fn ServerWebSocketPrototype__send(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ServerWebSocketPrototype__send") }
#[unsafe(no_mangle)] pub extern "C" fn ServerWebSocketPrototype__sendBinary(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ServerWebSocketPrototype__sendBinary") }
#[unsafe(no_mangle)] pub extern "C" fn ServerWebSocketPrototype__sendText(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ServerWebSocketPrototype__sendText") }
#[unsafe(no_mangle)] pub extern "C" fn ServerWebSocketPrototype__setBinaryType(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ServerWebSocketPrototype__setBinaryType") }
#[unsafe(no_mangle)] pub extern "C" fn ServerWebSocketPrototype__setData(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ServerWebSocketPrototype__setData") }
#[unsafe(no_mangle)] pub extern "C" fn ServerWebSocketPrototype__subscribe(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ServerWebSocketPrototype__subscribe") }
#[unsafe(no_mangle)] pub extern "C" fn ServerWebSocketPrototype__terminate(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ServerWebSocketPrototype__terminate") }
#[unsafe(no_mangle)] pub extern "C" fn ServerWebSocketPrototype__unsubscribe(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ServerWebSocketPrototype__unsubscribe") }
#[unsafe(no_mangle)] pub extern "C" fn ServerWebSocket__memoryCost(_p: *mut c_void) -> usize { unreachable!("codegen stub: ServerWebSocket__memoryCost") }
#[unsafe(no_mangle)] pub extern "C" fn ShellInterpreterClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: ShellInterpreterClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn ShellInterpreterPrototype__getStarted(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ShellInterpreterPrototype__getStarted") }
#[unsafe(no_mangle)] pub extern "C" fn ShellInterpreterPrototype__isRunning(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ShellInterpreterPrototype__isRunning") }
#[unsafe(no_mangle)] pub extern "C" fn ShellInterpreterPrototype__runFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: ShellInterpreterPrototype__runFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn ShellInterpreter__estimatedSize(_p: *mut c_void) -> usize { unreachable!("codegen stub: ShellInterpreter__estimatedSize") }
#[unsafe(no_mangle)] pub extern "C" fn ShellInterpreter__memoryCost(_p: *mut c_void) -> usize { unreachable!("codegen stub: ShellInterpreter__memoryCost") }
#[unsafe(no_mangle)] pub extern "C" fn SocketAddressClass__isSocketAddress(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SocketAddressClass__isSocketAddress") }
#[unsafe(no_mangle)] pub extern "C" fn SocketAddressClass__parse(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SocketAddressClass__parse") }
#[unsafe(no_mangle)] pub extern "C" fn SocketAddressPrototype__getAddrFamily(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SocketAddressPrototype__getAddrFamily") }
#[unsafe(no_mangle)] pub extern "C" fn SocketAddressPrototype__getAddress(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SocketAddressPrototype__getAddress") }
#[unsafe(no_mangle)] pub extern "C" fn SocketAddressPrototype__getFamily(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SocketAddressPrototype__getFamily") }
#[unsafe(no_mangle)] pub extern "C" fn SocketAddressPrototype__getFlowLabel(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SocketAddressPrototype__getFlowLabel") }
#[unsafe(no_mangle)] pub extern "C" fn SocketAddressPrototype__getPort(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SocketAddressPrototype__getPort") }
#[unsafe(no_mangle)] pub extern "C" fn SocketAddressPrototype__toJSON(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SocketAddressPrototype__toJSON") }
#[unsafe(no_mangle)] pub extern "C" fn SocketAddress__estimatedSize(_p: *mut c_void) -> usize { unreachable!("codegen stub: SocketAddress__estimatedSize") }
#[unsafe(no_mangle)] pub extern "C" fn SourceMapClass__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!("codegen stub: SourceMapClass__construct") }
#[unsafe(no_mangle)] pub extern "C" fn SourceMapClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: SourceMapClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn SourceMapPrototype__findEntry(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SourceMapPrototype__findEntry") }
#[unsafe(no_mangle)] pub extern "C" fn SourceMapPrototype__findOrigin(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SourceMapPrototype__findOrigin") }
#[unsafe(no_mangle)] pub extern "C" fn SourceMapPrototype__getLineLengths(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SourceMapPrototype__getLineLengths") }
#[unsafe(no_mangle)] pub extern "C" fn SourceMapPrototype__getPayload(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SourceMapPrototype__getPayload") }
#[unsafe(no_mangle)] pub extern "C" fn SourceMap__estimatedSize(_p: *mut c_void) -> usize { unreachable!("codegen stub: SourceMap__estimatedSize") }
#[unsafe(no_mangle)] pub extern "C" fn SourceMap__memoryCost(_p: *mut c_void) -> usize { unreachable!("codegen stub: SourceMap__memoryCost") }
#[unsafe(no_mangle)] pub extern "C" fn StatWatcherClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: StatWatcherClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn StatWatcherPrototype__doClose(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: StatWatcherPrototype__doClose") }
#[unsafe(no_mangle)] pub extern "C" fn StatWatcherPrototype__doRef(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: StatWatcherPrototype__doRef") }
#[unsafe(no_mangle)] pub extern "C" fn StatWatcherPrototype__doUnref(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: StatWatcherPrototype__doUnref") }
#[unsafe(no_mangle)] pub static StatWatcher__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn SubprocessPrototype__asyncDispose(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SubprocessPrototype__asyncDispose") }
#[unsafe(no_mangle)] pub extern "C" fn SubprocessPrototype__disconnect(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SubprocessPrototype__disconnect") }
#[unsafe(no_mangle)] pub extern "C" fn SubprocessPrototype__doRef(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SubprocessPrototype__doRef") }
#[unsafe(no_mangle)] pub extern "C" fn SubprocessPrototype__doSend(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SubprocessPrototype__doSend") }
#[unsafe(no_mangle)] pub extern "C" fn SubprocessPrototype__doUnref(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SubprocessPrototype__doUnref") }
#[unsafe(no_mangle)] pub extern "C" fn SubprocessPrototype__getConnected(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SubprocessPrototype__getConnected") }
#[unsafe(no_mangle)] pub extern "C" fn SubprocessPrototype__getExitCode(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SubprocessPrototype__getExitCode") }
#[unsafe(no_mangle)] pub extern "C" fn SubprocessPrototype__getExited(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SubprocessPrototype__getExited") }
#[unsafe(no_mangle)] pub extern "C" fn SubprocessPrototype__getKilled(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SubprocessPrototype__getKilled") }
#[unsafe(no_mangle)] pub extern "C" fn SubprocessPrototype__getPid(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SubprocessPrototype__getPid") }
#[unsafe(no_mangle)] pub extern "C" fn SubprocessPrototype__getSignalCode(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SubprocessPrototype__getSignalCode") }
#[unsafe(no_mangle)] pub extern "C" fn SubprocessPrototype__getStderr(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SubprocessPrototype__getStderr") }
#[unsafe(no_mangle)] pub extern "C" fn SubprocessPrototype__getStdin(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SubprocessPrototype__getStdin") }
#[unsafe(no_mangle)] pub extern "C" fn SubprocessPrototype__getStdio(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SubprocessPrototype__getStdio") }
#[unsafe(no_mangle)] pub extern "C" fn SubprocessPrototype__getStdout(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SubprocessPrototype__getStdout") }
#[unsafe(no_mangle)] pub extern "C" fn SubprocessPrototype__getTerminal(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SubprocessPrototype__getTerminal") }
#[unsafe(no_mangle)] pub extern "C" fn SubprocessPrototype__kill(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SubprocessPrototype__kill") }
#[unsafe(no_mangle)] pub extern "C" fn SubprocessPrototype__resourceUsage(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: SubprocessPrototype__resourceUsage") }
#[unsafe(no_mangle)] pub extern "C" fn Subprocess__memoryCost(_p: *mut c_void) -> usize { unreachable!("codegen stub: Subprocess__memoryCost") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: TCPSocketClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__close(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__close") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__disableRenegotiation(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__disableRenegotiation") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__end(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__end") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__endBuffered(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__endBuffered") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__exportKeyingMaterial(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__exportKeyingMaterial") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__flush(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__flush") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__getALPNProtocol(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__getALPNProtocol") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__getAuthorizationError(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__getAuthorizationError") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__getAuthorized(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__getAuthorized") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__getBytesWritten(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__getBytesWritten") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__getCertificate(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__getCertificate") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__getCipher(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__getCipher") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__getData(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__getData") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__getEphemeralKeyInfo(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__getEphemeralKeyInfo") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__getFD(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__getFD") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__getListener(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__getListener") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__getLocalAddress(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__getLocalAddress") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__getLocalFamily(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__getLocalFamily") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__getLocalPort(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__getLocalPort") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__getPeerCertificate(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__getPeerCertificate") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__getReadyState(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__getReadyState") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__getRemoteAddress(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__getRemoteAddress") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__getRemoteFamily(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__getRemoteFamily") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__getRemotePort(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__getRemotePort") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__getServername(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__getServername") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__getSession(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__getSession") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__getSharedSigalgs(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__getSharedSigalgs") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__getTLSFinishedMessage(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__getTLSFinishedMessage") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__getTLSPeerFinishedMessage(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__getTLSPeerFinishedMessage") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__getTLSTicket(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__getTLSTicket") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__getTLSVersion(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__getTLSVersion") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__isSessionReused(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__isSessionReused") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__jsRef(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__jsRef") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__jsUnref(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__jsUnref") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__pauseFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__pauseFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__reload(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__reload") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__renegotiate(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__renegotiate") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__resumeFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__resumeFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__setData(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__setData") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__setKeepAlive(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__setKeepAlive") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__setMaxSendFragment(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__setMaxSendFragment") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__setNoDelay(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__setNoDelay") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__setServername(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__setServername") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__setSession(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__setSession") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__setVerifyMode(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__setVerifyMode") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__shutdown(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__shutdown") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__terminate(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__terminate") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__timeout(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__timeout") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__upgradeTLS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__upgradeTLS") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__write(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__write") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocketPrototype__writeBuffered(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TCPSocketPrototype__writeBuffered") }
#[unsafe(no_mangle)] pub extern "C" fn TCPSocket__memoryCost(_p: *mut c_void) -> usize { unreachable!("codegen stub: TCPSocket__memoryCost") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: TLSSocketClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__close(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__close") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__disableRenegotiation(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__disableRenegotiation") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__end(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__end") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__endBuffered(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__endBuffered") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__exportKeyingMaterial(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__exportKeyingMaterial") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__flush(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__flush") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__getALPNProtocol(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__getALPNProtocol") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__getAuthorizationError(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__getAuthorizationError") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__getAuthorized(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__getAuthorized") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__getBytesWritten(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__getBytesWritten") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__getCertificate(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__getCertificate") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__getCipher(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__getCipher") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__getData(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__getData") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__getEphemeralKeyInfo(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__getEphemeralKeyInfo") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__getFD(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__getFD") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__getListener(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__getListener") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__getLocalAddress(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__getLocalAddress") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__getLocalFamily(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__getLocalFamily") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__getLocalPort(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__getLocalPort") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__getPeerCertificate(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__getPeerCertificate") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__getPeerX509Certificate(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__getPeerX509Certificate") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__getReadyState(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__getReadyState") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__getRemoteAddress(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__getRemoteAddress") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__getRemoteFamily(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__getRemoteFamily") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__getRemotePort(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__getRemotePort") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__getServername(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__getServername") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__getSession(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__getSession") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__getSharedSigalgs(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__getSharedSigalgs") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__getTLSFinishedMessage(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__getTLSFinishedMessage") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__getTLSPeerFinishedMessage(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__getTLSPeerFinishedMessage") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__getTLSTicket(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__getTLSTicket") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__getTLSVersion(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__getTLSVersion") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__getX509Certificate(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__getX509Certificate") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__isSessionReused(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__isSessionReused") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__jsRef(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__jsRef") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__jsUnref(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__jsUnref") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__pauseFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__pauseFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__reload(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__reload") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__renegotiate(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__renegotiate") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__resumeFromJS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__resumeFromJS") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__setData(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__setData") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__setKeepAlive(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__setKeepAlive") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__setMaxSendFragment(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__setMaxSendFragment") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__setNoDelay(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__setNoDelay") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__setServername(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__setServername") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__setSession(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__setSession") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__setVerifyMode(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__setVerifyMode") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__shutdown(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__shutdown") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__terminate(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__terminate") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__timeout(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__timeout") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__upgradeTLS(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__upgradeTLS") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__write(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__write") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocketPrototype__writeBuffered(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TLSSocketPrototype__writeBuffered") }
#[unsafe(no_mangle)] pub extern "C" fn TLSSocket__memoryCost(_p: *mut c_void) -> usize { unreachable!("codegen stub: TLSSocket__memoryCost") }
#[unsafe(no_mangle)] pub extern "C" fn TerminalClass__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!("codegen stub: TerminalClass__construct") }
#[unsafe(no_mangle)] pub extern "C" fn TerminalClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: TerminalClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn TerminalPrototype__asyncDispose(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TerminalPrototype__asyncDispose") }
#[unsafe(no_mangle)] pub extern "C" fn TerminalPrototype__close(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TerminalPrototype__close") }
#[unsafe(no_mangle)] pub extern "C" fn TerminalPrototype__doRef(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TerminalPrototype__doRef") }
#[unsafe(no_mangle)] pub extern "C" fn TerminalPrototype__doUnref(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TerminalPrototype__doUnref") }
#[unsafe(no_mangle)] pub extern "C" fn TerminalPrototype__getClosed(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TerminalPrototype__getClosed") }
#[unsafe(no_mangle)] pub extern "C" fn TerminalPrototype__getControlFlags(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TerminalPrototype__getControlFlags") }
#[unsafe(no_mangle)] pub extern "C" fn TerminalPrototype__getInputFlags(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TerminalPrototype__getInputFlags") }
#[unsafe(no_mangle)] pub extern "C" fn TerminalPrototype__getLocalFlags(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TerminalPrototype__getLocalFlags") }
#[unsafe(no_mangle)] pub extern "C" fn TerminalPrototype__getOutputFlags(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TerminalPrototype__getOutputFlags") }
#[unsafe(no_mangle)] pub extern "C" fn TerminalPrototype__resize(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TerminalPrototype__resize") }
#[unsafe(no_mangle)] pub extern "C" fn TerminalPrototype__setControlFlags(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TerminalPrototype__setControlFlags") }
#[unsafe(no_mangle)] pub extern "C" fn TerminalPrototype__setInputFlags(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TerminalPrototype__setInputFlags") }
#[unsafe(no_mangle)] pub extern "C" fn TerminalPrototype__setLocalFlags(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TerminalPrototype__setLocalFlags") }
#[unsafe(no_mangle)] pub extern "C" fn TerminalPrototype__setOutputFlags(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TerminalPrototype__setOutputFlags") }
#[unsafe(no_mangle)] pub extern "C" fn TerminalPrototype__setRawMode(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TerminalPrototype__setRawMode") }
#[unsafe(no_mangle)] pub extern "C" fn TerminalPrototype__write(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TerminalPrototype__write") }
#[unsafe(no_mangle)] pub static Terminal__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn TextChunkClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: TextChunkClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn TextChunkPrototype__after(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TextChunkPrototype__after") }
#[unsafe(no_mangle)] pub extern "C" fn TextChunkPrototype__before(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TextChunkPrototype__before") }
#[unsafe(no_mangle)] pub extern "C" fn TextChunkPrototype__getText(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TextChunkPrototype__getText") }
#[unsafe(no_mangle)] pub extern "C" fn TextChunkPrototype__lastInTextNode(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TextChunkPrototype__lastInTextNode") }
#[unsafe(no_mangle)] pub extern "C" fn TextChunkPrototype__remove(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TextChunkPrototype__remove") }
#[unsafe(no_mangle)] pub extern "C" fn TextChunkPrototype__removed(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TextChunkPrototype__removed") }
#[unsafe(no_mangle)] pub extern "C" fn TextChunkPrototype__replace(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TextChunkPrototype__replace") }
#[unsafe(no_mangle)] pub static TextChunk__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn TextDecoderClass__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!("codegen stub: TextDecoderClass__construct") }
#[unsafe(no_mangle)] pub extern "C" fn TextDecoderClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: TextDecoderClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn TextDecoderPrototype__decode(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TextDecoderPrototype__decode") }
#[unsafe(no_mangle)] pub extern "C" fn TextDecoderPrototype__getEncoding(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TextDecoderPrototype__getEncoding") }
#[unsafe(no_mangle)] pub extern "C" fn TextDecoderPrototype__getFatal(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TextDecoderPrototype__getFatal") }
#[unsafe(no_mangle)] pub extern "C" fn TextDecoderPrototype__getIgnoreBOM(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TextDecoderPrototype__getIgnoreBOM") }
#[unsafe(no_mangle)] pub static TextDecoder__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn TextEncoderStreamEncoderPrototype__encode(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TextEncoderStreamEncoderPrototype__encode") }
#[unsafe(no_mangle)] pub extern "C" fn TextEncoderStreamEncoderPrototype__flush(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TextEncoderStreamEncoderPrototype__flush") }
#[unsafe(no_mangle)] pub static TextEncoderStreamEncoder__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn TimeoutClass__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!("codegen stub: TimeoutClass__construct") }
#[unsafe(no_mangle)] pub extern "C" fn TimeoutClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: TimeoutClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn TimeoutPrototype__close(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TimeoutPrototype__close") }
#[unsafe(no_mangle)] pub extern "C" fn TimeoutPrototype__dispose(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TimeoutPrototype__dispose") }
#[unsafe(no_mangle)] pub extern "C" fn TimeoutPrototype__doRef(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TimeoutPrototype__doRef") }
#[unsafe(no_mangle)] pub extern "C" fn TimeoutPrototype__doRefresh(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TimeoutPrototype__doRefresh") }
#[unsafe(no_mangle)] pub extern "C" fn TimeoutPrototype__doUnref(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TimeoutPrototype__doUnref") }
#[unsafe(no_mangle)] pub extern "C" fn TimeoutPrototype__getDestroyed(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TimeoutPrototype__getDestroyed") }
#[unsafe(no_mangle)] pub extern "C" fn TimeoutPrototype__get_idleStart(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TimeoutPrototype__get_idleStart") }
#[unsafe(no_mangle)] pub extern "C" fn TimeoutPrototype__get_idleTimeout(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TimeoutPrototype__get_idleTimeout") }
#[unsafe(no_mangle)] pub extern "C" fn TimeoutPrototype__get_onTimeout(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TimeoutPrototype__get_onTimeout") }
#[unsafe(no_mangle)] pub extern "C" fn TimeoutPrototype__get_repeat(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TimeoutPrototype__get_repeat") }
#[unsafe(no_mangle)] pub extern "C" fn TimeoutPrototype__hasRef(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TimeoutPrototype__hasRef") }
#[unsafe(no_mangle)] pub extern "C" fn TimeoutPrototype__set_idleStart(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TimeoutPrototype__set_idleStart") }
#[unsafe(no_mangle)] pub extern "C" fn TimeoutPrototype__set_idleTimeout(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TimeoutPrototype__set_idleTimeout") }
#[unsafe(no_mangle)] pub extern "C" fn TimeoutPrototype__set_onTimeout(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TimeoutPrototype__set_onTimeout") }
#[unsafe(no_mangle)] pub extern "C" fn TimeoutPrototype__set_repeat(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TimeoutPrototype__set_repeat") }
#[unsafe(no_mangle)] pub extern "C" fn TimeoutPrototype__toPrimitive(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TimeoutPrototype__toPrimitive") }
#[unsafe(no_mangle)] pub static Timeout__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn TranspilerClass__construct(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!("codegen stub: TranspilerClass__construct") }
#[unsafe(no_mangle)] pub extern "C" fn TranspilerClass__finalize(_p: *mut c_void) { unreachable!("codegen stub: TranspilerClass__finalize") }
#[unsafe(no_mangle)] pub extern "C" fn TranspilerPrototype__scan(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TranspilerPrototype__scan") }
#[unsafe(no_mangle)] pub extern "C" fn TranspilerPrototype__scanImports(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TranspilerPrototype__scanImports") }
#[unsafe(no_mangle)] pub extern "C" fn TranspilerPrototype__transform(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TranspilerPrototype__transform") }
#[unsafe(no_mangle)] pub extern "C" fn TranspilerPrototype__transformSync(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: TranspilerPrototype__transformSync") }
#[unsafe(no_mangle)] pub static Transpiler__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn UDPSocketPrototype__addMembership(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: UDPSocketPrototype__addMembership") }
#[unsafe(no_mangle)] pub extern "C" fn UDPSocketPrototype__addSourceSpecificMembership(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: UDPSocketPrototype__addSourceSpecificMembership") }
#[unsafe(no_mangle)] pub extern "C" fn UDPSocketPrototype__close(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: UDPSocketPrototype__close") }
#[unsafe(no_mangle)] pub extern "C" fn UDPSocketPrototype__dropMembership(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: UDPSocketPrototype__dropMembership") }
#[unsafe(no_mangle)] pub extern "C" fn UDPSocketPrototype__dropSourceSpecificMembership(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: UDPSocketPrototype__dropSourceSpecificMembership") }
#[unsafe(no_mangle)] pub extern "C" fn UDPSocketPrototype__getAddress(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: UDPSocketPrototype__getAddress") }
#[unsafe(no_mangle)] pub extern "C" fn UDPSocketPrototype__getBinaryType(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: UDPSocketPrototype__getBinaryType") }
#[unsafe(no_mangle)] pub extern "C" fn UDPSocketPrototype__getClosed(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: UDPSocketPrototype__getClosed") }
#[unsafe(no_mangle)] pub extern "C" fn UDPSocketPrototype__getHostname(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: UDPSocketPrototype__getHostname") }
#[unsafe(no_mangle)] pub extern "C" fn UDPSocketPrototype__getPort(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: UDPSocketPrototype__getPort") }
#[unsafe(no_mangle)] pub extern "C" fn UDPSocketPrototype__getRemoteAddress(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: UDPSocketPrototype__getRemoteAddress") }
#[unsafe(no_mangle)] pub extern "C" fn UDPSocketPrototype__ref(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: UDPSocketPrototype__ref") }
#[unsafe(no_mangle)] pub extern "C" fn UDPSocketPrototype__reload(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: UDPSocketPrototype__reload") }
#[unsafe(no_mangle)] pub extern "C" fn UDPSocketPrototype__send(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: UDPSocketPrototype__send") }
#[unsafe(no_mangle)] pub extern "C" fn UDPSocketPrototype__sendMany(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: UDPSocketPrototype__sendMany") }
#[unsafe(no_mangle)] pub extern "C" fn UDPSocketPrototype__setBroadcast(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: UDPSocketPrototype__setBroadcast") }
#[unsafe(no_mangle)] pub extern "C" fn UDPSocketPrototype__setMulticastInterface(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: UDPSocketPrototype__setMulticastInterface") }
#[unsafe(no_mangle)] pub extern "C" fn UDPSocketPrototype__setMulticastLoopback(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: UDPSocketPrototype__setMulticastLoopback") }
#[unsafe(no_mangle)] pub extern "C" fn UDPSocketPrototype__setMulticastTTL(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: UDPSocketPrototype__setMulticastTTL") }
#[unsafe(no_mangle)] pub extern "C" fn UDPSocketPrototype__setTTL(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: UDPSocketPrototype__setTTL") }
#[unsafe(no_mangle)] pub extern "C" fn UDPSocketPrototype__unref(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: UDPSocketPrototype__unref") }
#[unsafe(no_mangle)] pub static UDPSocket__ZigStructSize: usize = 0;
#[unsafe(no_mangle)] pub extern "C" fn bindgen_BunObject_dispatchBraces1(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: bindgen_BunObject_dispatchBraces1") }
#[unsafe(no_mangle)] pub extern "C" fn bindgen_BunObject_dispatchGc1(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: bindgen_BunObject_dispatchGc1") }
#[unsafe(no_mangle)] pub extern "C" fn bindgen_NodeModuleModule_dispatch_stat1(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!("codegen stub: bindgen_NodeModuleModule_dispatch_stat1") }
