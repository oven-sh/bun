// This implements error deserialization from the WebSocket protocol
import { BundlerMessageLevel } from "../enums";
import { DataViewReader } from "./reader";

export type DeserializedFailure = BundlerMessage;

export interface BundlerMessage {
  kind: "bundler";
  level: BundlerMessageLevel;
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

export function decodeSerializedError(reader: DataViewReader) {
  const kind = reader.u8();
  if (kind >= 0 && kind <= 4) {
    return readLogMsg(reader, kind);
  } else {
    throw new Error("TODO: JS Errors");
  }
}

/** First byte is already read in. */
function readLogMsg(r: DataViewReader, kind: BundlerMessageLevel) {
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
