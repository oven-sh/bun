// Shape of the JSON payload the `Bun.serve({ development: true })` error page
// embeds in `<script id="__bunfallback" type="application/json">`.
// Produced by src/runtime/server/DevErrorPage.rs.

export enum StackFrameScope {
  Eval = 1,
  Module = 2,
  Function = 3,
  Global = 4,
  Wasm = 5,
  Constructor = 6,
}

export interface StackFramePosition {
  /** 1-based; -1 when the frame has no source position */
  line: number;
  /** 1-based; -1 when the frame has no source position */
  column: number;
  // Only set on frames built client-side (runtime-error.ts, source-map remapping in index.tsx).
  source_offset?: number;
  line_start?: number;
  line_stop?: number;
  column_start?: number;
  column_stop?: number;
  expression_start?: number;
  expression_stop?: number;
}

export interface StackFrame {
  function_name: string;
  file: string;
  position: StackFramePosition;
  scope: StackFrameScope;
}

export interface SourceLine {
  /** 1-based */
  line: number;
  text: string;
}

export interface StackTrace {
  source_lines: SourceLine[];
  frames: StackFrame[];
}

export interface JSException {
  name?: string;
  message?: string;
  /** `JSRuntimeType` flags */
  runtime_type?: number;
  /** `JSErrorCode` */
  code?: number;
  stack?: StackTrace;
}

export const enum MessageLevel {
  err = 1,
  warn = 2,
  note = 3,
  info = 4,
  debug = 5,
}

export interface Location {
  file: string;
  namespace: string;
  line: number;
  column: number;
  line_text: string;
  offset: number;
}

export interface MessageData {
  text?: string;
  location?: Location;
}

export interface MessageMeta {
  /** The specifier that failed to resolve, for resolve errors. */
  resolve?: string;
  build?: boolean;
}

export interface Message {
  level: MessageLevel;
  data: MessageData;
  notes: MessageData[];
  on: MessageMeta;
}

export interface Log {
  warnings: number;
  errors: number;
  msgs: Message[];
}

export interface Problems {
  exceptions: JSException[];
  build: Log;
}

export interface FallbackMessageContainer {
  /** One-line summary of what failed, e.g. "GET /foo failed" */
  message?: string;
  problems?: Problems;
  cwd?: string;
}
