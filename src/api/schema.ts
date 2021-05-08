import type {ByteBuffer} from "peechy";

type byte = number;
type float = number;
type int = number;
type alphanumeric = string;
type uint = number;
type int8 = number;
type lowp = number;
type int16 = number;
type int32 = number;
type float32 = number;
type uint16 = number;
type uint32 = number;
  export enum Loader {
    jsx = 1,
    js = 2,
    ts = 3,
    tsx = 4,
    css = 5,
    file = 6,
    json = 7
  }
  export const LoaderKeys = {
    1: "jsx",
    jsx: "jsx",
    2: "js",
    js: "js",
    3: "ts",
    ts: "ts",
    4: "tsx",
    tsx: "tsx",
    5: "css",
    css: "css",
    6: "file",
    file: "file",
    7: "json",
    json: "json"
  }
  export enum JSXRuntime {
    automatic = 1,
    classic = 2
  }
  export const JSXRuntimeKeys = {
    1: "automatic",
    automatic: "automatic",
    2: "classic",
    classic: "classic"
  }
  export enum TransformResponseStatus {
    success = 1,
    fail = 2
  }
  export const TransformResponseStatusKeys = {
    1: "success",
    success: "success",
    2: "fail",
    fail: "fail"
  }
  export enum MessageKind {
    err = 1,
    warn = 2,
    note = 3,
    debug = 4
  }
  export const MessageKindKeys = {
    1: "err",
    err: "err",
    2: "warn",
    warn: "warn",
    3: "note",
    note: "note",
    4: "debug",
    debug: "debug"
  }
  export interface JSX {
    factory: string;
    runtime: JSXRuntime;
    fragment: string;
    production: boolean;
    import_source: string;
    react_fast_refresh: boolean;
    loader_keys: string[];
    loader_values: Loader[];
  }

  export interface TransformOptions {
    jsx: JSX;
    ts: boolean;
    base_path: string;
    define_keys: string[];
    define_values: string[];
  }

  export interface FileHandle {
    path: string;
    size: uint;
    fd: uint;
  }

  export interface Transform {
    handle?: FileHandle;
    path?: string;
    contents?: Uint8Array;
    loader?: Loader;
    options?: TransformOptions;
  }

  export interface OutputFile {
    data: Uint8Array;
    path: string;
  }

  export interface TransformResponse {
    status: TransformResponseStatus;
    files: OutputFile[];
    errors: Message[];
  }

  export interface Location {
    file: string;
    namespace: string;
    line: int32;
    column: int32;
    line_text: string;
    suggestion: string;
    offset: uint;
  }

  export interface MessageData {
    text?: string;
    location?: Location;
  }

  export interface Message {
    kind: MessageKind;
    data: MessageData;
    notes: MessageData[];
  }

  export interface Log {
    warnings: uint32;
    errors: uint32;
    msgs: Message[];
  }

  export declare function  encodeJSX(message: JSX, bb: ByteBuffer): void;
  export declare function decodeJSX(buffer: ByteBuffer): JSX;
  export declare function  encodeTransformOptions(message: TransformOptions, bb: ByteBuffer): void;
  export declare function decodeTransformOptions(buffer: ByteBuffer): TransformOptions;
  export declare function  encodeFileHandle(message: FileHandle, bb: ByteBuffer): void;
  export declare function decodeFileHandle(buffer: ByteBuffer): FileHandle;
  export declare function  encodeTransform(message: Transform, bb: ByteBuffer): void;
  export declare function decodeTransform(buffer: ByteBuffer): Transform;
  export declare function  encodeOutputFile(message: OutputFile, bb: ByteBuffer): void;
  export declare function decodeOutputFile(buffer: ByteBuffer): OutputFile;
  export declare function  encodeTransformResponse(message: TransformResponse, bb: ByteBuffer): void;
  export declare function decodeTransformResponse(buffer: ByteBuffer): TransformResponse;
  export declare function  encodeLocation(message: Location, bb: ByteBuffer): void;
  export declare function decodeLocation(buffer: ByteBuffer): Location;
  export declare function  encodeMessageData(message: MessageData, bb: ByteBuffer): void;
  export declare function decodeMessageData(buffer: ByteBuffer): MessageData;
  export declare function  encodeMessage(message: Message, bb: ByteBuffer): void;
  export declare function decodeMessage(buffer: ByteBuffer): Message;
  export declare function  encodeLog(message: Log, bb: ByteBuffer): void;
  export declare function decodeLog(buffer: ByteBuffer): Log;
