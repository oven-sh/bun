const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;

pub const createBrotliEncoder = bun.JSC.API.BrotliEncoder.create;

pub const createBrotliDecoder = bun.JSC.API.BrotliDecoder.create;

pub const createDeflateEncoder = bun.JSC.API.DeflateEncoder.create;

pub const createDeflateDecoder = bun.JSC.API.DeflateDecoder.create;

pub const createGzipEncoder = bun.JSC.API.GzipEncoder.create;

pub const createGzipDecoder = bun.JSC.API.GzipDecoder.create;

pub const createZlibEncoder = bun.JSC.API.ZlibEncoder.create;

pub const createZlibDecoder = bun.JSC.API.ZlibDecoder.create;
