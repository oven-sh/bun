// This implements error deserialization from the WebSocket protocol
import { BundlerMessageLevel } from "../enums";
import { DataViewReader } from "./data-view";

export interface DeserializedFailure {
  // If not specified, it is a client-side error.
  file: string | null;
  messages: BundlerMessage[];
}

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
  /** One-based, relative to the whole source line (not to `lineText`) */
  column: number;
  /** Byte length */
  length: number;
  /**
   * Number of columns of the source line that precede `lineText`. Non-zero
   * when `lineText` is only a window of a long line, so the highlight starts
   * `column - 1 - lineTextColumnOffset` characters into `lineText`.
   */
  lineTextColumnOffset: number;
  /** The source line, or a window of it around the highlighted range. */
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
function readLogMsg(r: DataViewReader, level: BundlerMessageLevel) {
  const message = r.string32();
  const location = readBundlerMessageLocationOrNull(r);
  const noteCount = r.u32();
  const notes = new Array(noteCount);
  for (let i = 0; i < noteCount; i++) {
    notes[i] = readLogData(r);
  }
  return {
    kind: "bundler",
    level,
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
  const length = r.u32();
  const lineTextColumnOffset = r.u32();
  const lineText = r.string32();

  return {
    line,
    column,
    length,
    lineTextColumnOffset,
    lineText,
  };
}
