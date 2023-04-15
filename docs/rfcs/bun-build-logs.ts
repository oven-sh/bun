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
  suggestion: string;
  offset: number;
}

export interface MessageData {
  text?: string;
  location?: Location;
}

export interface MessageMeta {
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
