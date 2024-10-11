import { DataViewReader } from "./reader";

export const enum BundlerMessageKind {
  err = 0,
  warn = 1,
  note = 2,
  debug = 3,
  verbose = 4,
}

export interface BundlerMessage {
  kind: BundlerMessageKind;
  message: string;
  location: BundlerMessageLocation | null;
  notes: BundlerNote[];
}

export interface BundlerMessageLocation {
  /** One-based */
  line: number;
  /** Zero-based byte offset */
  column: number;

  namespace: string;
  file: string;
  lineText: string;
}

export interface BundlerNote {
  message: string;
  location: BundlerMessageLocation | null;
}

export function decodeSerializedErrorPayload(arrayBuffer: DataView, start: number) {
  const r = new DataViewReader(arrayBuffer, start);
  const messageCount = r.u32();
  const messages = new Array(messageCount);
  for (let i = 0; i < messageCount; i++) {
    const kind = r.u8();
    // TODO: JS errors
    messages[i] = readLogMsg(r, kind);
  }
  return messages;
}

/** First byte is already read in. */
function readLogMsg(r: DataViewReader, kind: BundlerMessageKind) {
  const message = r.string32();
  const location = readBundlerMessageLocationOrNull(r);
  const noteCount = r.u32();
  const notes = new Array(noteCount);
  for (let i = 0; i < noteCount; i++) {
    notes[i] = readLogData(r);
  }
  return {
    kind,
    message,
    location,
    notes,
  };
}

function readLogData(r: DataViewReader): BundlerNote | null {
  return {
    message: r.string32(),
    location: readBundlerMessageLocationOrNull(r),
  };
}

function readBundlerMessageLocationOrNull(r: DataViewReader): BundlerMessageLocation | null {
  const line = r.u32();
  if (line == 0) return null;

  const column = r.u32();
  const namespace = r.string32();
  const file = r.string32();
  const lineText = r.string32();

  return {
    line,
    column,
    namespace,
    file,
    lineText,
  };
}
