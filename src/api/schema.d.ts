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
  export enum ResolveMode {
    disable = 1,
    lazy = 2,
    dev = 3,
    bundle = 4
  }
  export const ResolveModeKeys = {
    1: "disable",
    disable: "disable",
    2: "lazy",
    lazy: "lazy",
    3: "dev",
    dev: "dev",
    4: "bundle",
    bundle: "bundle"
  }
  export enum Platform {
    browser = 1,
    node = 2,
    speedy = 3
  }
  export const PlatformKeys = {
    1: "browser",
    browser: "browser",
    2: "node",
    node: "node",
    3: "speedy",
    speedy: "speedy"
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
  export enum ScanDependencyMode {
    app = 1,
    all = 2
  }
  export const ScanDependencyModeKeys = {
    1: "app",
    app: "app",
    2: "all",
    all: "all"
  }
  export enum ModuleImportType {
    import = 1,
    require = 2
  }
  export const ModuleImportTypeKeys = {
    1: "import",
    import: "import",
    2: "require",
    require: "require"
  }
  export enum DotEnvBehavior {
    disable = 1,
    prefix = 2,
    load_all = 3
  }
  export const DotEnvBehaviorKeys = {
    1: "disable",
    disable: "disable",
    2: "prefix",
    prefix: "prefix",
    3: "load_all",
    load_all: "load_all"
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
  export enum Reloader {
    disable = 1,
    live = 2,
    fast_refresh = 3
  }
  export const ReloaderKeys = {
    1: "disable",
    disable: "disable",
    2: "live",
    live: "live",
    3: "fast_refresh",
    fast_refresh: "fast_refresh"
  }
  export enum WebsocketMessageKind {
    welcome = 1,
    file_change_notification = 2,
    build_success = 3,
    build_fail = 4,
    manifest_success = 5,
    manifest_fail = 6
  }
  export const WebsocketMessageKindKeys = {
    1: "welcome",
    welcome: "welcome",
    2: "file_change_notification",
    file_change_notification: "file_change_notification",
    3: "build_success",
    build_success: "build_success",
    4: "build_fail",
    build_fail: "build_fail",
    5: "manifest_success",
    manifest_success: "manifest_success",
    6: "manifest_fail",
    manifest_fail: "manifest_fail"
  }
  export enum WebsocketCommandKind {
    build = 1,
    manifest = 2
  }
  export const WebsocketCommandKindKeys = {
    1: "build",
    build: "build",
    2: "manifest",
    manifest: "manifest"
  }
  export interface JSX {
    factory: string;
    runtime: JSXRuntime;
    fragment: string;
    development: boolean;
    import_source: string;
    react_fast_refresh: boolean;
  }

  export interface StringPointer {
    offset: uint32;
    length: uint32;
  }

  export interface JavascriptBundledModule {
    path: StringPointer;
    code: StringPointer;
    package_id: uint32;
    id: uint32;
    path_extname_length: byte;
  }

  export interface JavascriptBundledPackage {
    name: StringPointer;
    version: StringPointer;
    hash: uint32;
    modules_offset: uint32;
    modules_length: uint32;
  }

  export interface JavascriptBundle {
    modules: JavascriptBundledModule[];
    packages: JavascriptBundledPackage[];
    etag: Uint8Array;
    generated_at: uint32;
    app_package_json_dependencies_hash: Uint8Array;
    import_from_name: Uint8Array;
    manifest_string: Uint8Array;
  }

  export interface JavascriptBundleContainer {
    bundle_format_version?: uint32;
    bundle?: JavascriptBundle;
    framework?: LoadedFramework;
    routes?: LoadedRouteConfig;
    code_length?: uint32;
  }

  export interface ModuleImportRecord {
    kind: ModuleImportType;
    path: string;
    dynamic: boolean;
  }

  export interface Module {
    path: string;
    imports: ModuleImportRecord[];
  }

  export interface StringMap {
    keys: string[];
    values: string[];
  }

  export interface LoaderMap {
    extensions: string[];
    loaders: Loader[];
  }

  export interface EnvConfig {
    prefix?: string;
    defaults?: StringMap;
  }

  export interface LoadedEnvConfig {
    dotenv: DotEnvBehavior;
    defaults: StringMap;
    prefix: string;
  }

  export interface FrameworkConfig {
    package?: string;
    client?: string;
    server?: string;
    development?: boolean;
    client_env?: EnvConfig;
    server_env?: EnvConfig;
  }

  export interface LoadedFramework {
    entry_point: string;
    package: string;
    development: boolean;
    client: boolean;
    env: LoadedEnvConfig;
  }

  export interface LoadedRouteConfig {
    dir: string;
    extensions: string[];
    static_dir: string;
    asset_prefix: string;
  }

  export interface RouteConfig {
    dir?: string[];
    extensions?: string[];
    static_dir?: string;
    asset_prefix?: string;
  }

  export interface TransformOptions {
    jsx?: JSX;
    tsconfig_override?: string;
    resolve?: ResolveMode;
    origin?: string;
    absolute_working_dir?: string;
    define?: StringMap;
    preserve_symlinks?: boolean;
    entry_points?: string[];
    write?: boolean;
    inject?: string[];
    output_dir?: string;
    external?: string[];
    loaders?: LoaderMap;
    main_fields?: string[];
    platform?: Platform;
    serve?: boolean;
    extension_order?: string[];
    only_scan_dependencies?: ScanDependencyMode;
    generate_node_module_bundle?: boolean;
    node_modules_bundle_path?: string;
    node_modules_bundle_path_server?: string;
    framework?: FrameworkConfig;
    router?: RouteConfig;
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

  export interface WebsocketMessage {
    timestamp: uint32;
    kind: WebsocketMessageKind;
  }

  export interface WebsocketMessageWelcome {
    epoch: uint32;
    javascriptReloader: Reloader;
  }

  export interface WebsocketMessageFileChangeNotification {
    id: uint32;
    loader: Loader;
  }

  export interface WebsocketCommand {
    kind: WebsocketCommandKind;
    timestamp: uint32;
  }

  export interface WebsocketCommandBuild {
    id: uint32;
  }

  export interface WebsocketCommandManifest {
    id: uint32;
  }

  export interface WebsocketMessageBuildSuccess {
    id: uint32;
    from_timestamp: uint32;
    loader: Loader;
    module_path: string;
    blob_length: uint32;
  }

  export interface WebsocketMessageBuildFailure {
    id: uint32;
    from_timestamp: uint32;
    loader: Loader;
    module_path: string;
    log: Log;
  }

  export interface DependencyManifest {
    ids: Uint32Array;
  }

  export interface FileList {
    ptrs: StringPointer[];
    files: string;
  }

  export interface WebsocketMessageResolveIDs {
    id: Uint32Array;
    list: FileList;
  }

  export interface WebsocketCommandResolveIDs {
    ptrs: StringPointer[];
    files: string;
  }

  export interface WebsocketMessageManifestSuccess {
    id: uint32;
    module_path: string;
    loader: Loader;
    manifest: DependencyManifest;
  }

  export interface WebsocketMessageManifestFailure {
    id: uint32;
    from_timestamp: uint32;
    loader: Loader;
    log: Log;
  }

  export declare function  encodeJSX(message: JSX, bb: ByteBuffer): void;
  export declare function decodeJSX(buffer: ByteBuffer): JSX;
  export declare function  encodeStringPointer(message: StringPointer, bb: ByteBuffer): void;
  export declare function decodeStringPointer(buffer: ByteBuffer): StringPointer;
  export declare function  encodeJavascriptBundledModule(message: JavascriptBundledModule, bb: ByteBuffer): void;
  export declare function decodeJavascriptBundledModule(buffer: ByteBuffer): JavascriptBundledModule;
  export declare function  encodeJavascriptBundledPackage(message: JavascriptBundledPackage, bb: ByteBuffer): void;
  export declare function decodeJavascriptBundledPackage(buffer: ByteBuffer): JavascriptBundledPackage;
  export declare function  encodeJavascriptBundle(message: JavascriptBundle, bb: ByteBuffer): void;
  export declare function decodeJavascriptBundle(buffer: ByteBuffer): JavascriptBundle;
  export declare function  encodeJavascriptBundleContainer(message: JavascriptBundleContainer, bb: ByteBuffer): void;
  export declare function decodeJavascriptBundleContainer(buffer: ByteBuffer): JavascriptBundleContainer;
  export declare function  encodeModuleImportRecord(message: ModuleImportRecord, bb: ByteBuffer): void;
  export declare function decodeModuleImportRecord(buffer: ByteBuffer): ModuleImportRecord;
  export declare function  encodeModule(message: Module, bb: ByteBuffer): void;
  export declare function decodeModule(buffer: ByteBuffer): Module;
  export declare function  encodeStringMap(message: StringMap, bb: ByteBuffer): void;
  export declare function decodeStringMap(buffer: ByteBuffer): StringMap;
  export declare function  encodeLoaderMap(message: LoaderMap, bb: ByteBuffer): void;
  export declare function decodeLoaderMap(buffer: ByteBuffer): LoaderMap;
  export declare function  encodeEnvConfig(message: EnvConfig, bb: ByteBuffer): void;
  export declare function decodeEnvConfig(buffer: ByteBuffer): EnvConfig;
  export declare function  encodeLoadedEnvConfig(message: LoadedEnvConfig, bb: ByteBuffer): void;
  export declare function decodeLoadedEnvConfig(buffer: ByteBuffer): LoadedEnvConfig;
  export declare function  encodeFrameworkConfig(message: FrameworkConfig, bb: ByteBuffer): void;
  export declare function decodeFrameworkConfig(buffer: ByteBuffer): FrameworkConfig;
  export declare function  encodeLoadedFramework(message: LoadedFramework, bb: ByteBuffer): void;
  export declare function decodeLoadedFramework(buffer: ByteBuffer): LoadedFramework;
  export declare function  encodeLoadedRouteConfig(message: LoadedRouteConfig, bb: ByteBuffer): void;
  export declare function decodeLoadedRouteConfig(buffer: ByteBuffer): LoadedRouteConfig;
  export declare function  encodeRouteConfig(message: RouteConfig, bb: ByteBuffer): void;
  export declare function decodeRouteConfig(buffer: ByteBuffer): RouteConfig;
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
  export declare function  encodeWebsocketMessage(message: WebsocketMessage, bb: ByteBuffer): void;
  export declare function decodeWebsocketMessage(buffer: ByteBuffer): WebsocketMessage;
  export declare function  encodeWebsocketMessageWelcome(message: WebsocketMessageWelcome, bb: ByteBuffer): void;
  export declare function decodeWebsocketMessageWelcome(buffer: ByteBuffer): WebsocketMessageWelcome;
  export declare function  encodeWebsocketMessageFileChangeNotification(message: WebsocketMessageFileChangeNotification, bb: ByteBuffer): void;
  export declare function decodeWebsocketMessageFileChangeNotification(buffer: ByteBuffer): WebsocketMessageFileChangeNotification;
  export declare function  encodeWebsocketCommand(message: WebsocketCommand, bb: ByteBuffer): void;
  export declare function decodeWebsocketCommand(buffer: ByteBuffer): WebsocketCommand;
  export declare function  encodeWebsocketCommandBuild(message: WebsocketCommandBuild, bb: ByteBuffer): void;
  export declare function decodeWebsocketCommandBuild(buffer: ByteBuffer): WebsocketCommandBuild;
  export declare function  encodeWebsocketCommandManifest(message: WebsocketCommandManifest, bb: ByteBuffer): void;
  export declare function decodeWebsocketCommandManifest(buffer: ByteBuffer): WebsocketCommandManifest;
  export declare function  encodeWebsocketMessageBuildSuccess(message: WebsocketMessageBuildSuccess, bb: ByteBuffer): void;
  export declare function decodeWebsocketMessageBuildSuccess(buffer: ByteBuffer): WebsocketMessageBuildSuccess;
  export declare function  encodeWebsocketMessageBuildFailure(message: WebsocketMessageBuildFailure, bb: ByteBuffer): void;
  export declare function decodeWebsocketMessageBuildFailure(buffer: ByteBuffer): WebsocketMessageBuildFailure;
  export declare function  encodeDependencyManifest(message: DependencyManifest, bb: ByteBuffer): void;
  export declare function decodeDependencyManifest(buffer: ByteBuffer): DependencyManifest;
  export declare function  encodeFileList(message: FileList, bb: ByteBuffer): void;
  export declare function decodeFileList(buffer: ByteBuffer): FileList;
  export declare function  encodeWebsocketMessageResolveIDs(message: WebsocketMessageResolveIDs, bb: ByteBuffer): void;
  export declare function decodeWebsocketMessageResolveIDs(buffer: ByteBuffer): WebsocketMessageResolveIDs;
  export declare function  encodeWebsocketCommandResolveIDs(message: WebsocketCommandResolveIDs, bb: ByteBuffer): void;
  export declare function decodeWebsocketCommandResolveIDs(buffer: ByteBuffer): WebsocketCommandResolveIDs;
  export declare function  encodeWebsocketMessageManifestSuccess(message: WebsocketMessageManifestSuccess, bb: ByteBuffer): void;
  export declare function decodeWebsocketMessageManifestSuccess(buffer: ByteBuffer): WebsocketMessageManifestSuccess;
  export declare function  encodeWebsocketMessageManifestFailure(message: WebsocketMessageManifestFailure, bb: ByteBuffer): void;
  export declare function decodeWebsocketMessageManifestFailure(buffer: ByteBuffer): WebsocketMessageManifestFailure;
