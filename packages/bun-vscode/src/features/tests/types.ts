export type TestNode = {
  name: string;
  type: "describe" | "test" | "it";
  line: number;
  children: TestNode[];
  parent?: TestNode;
  startIdx: number;
};

// Inspector Protocol Types - These match Bun's actual protocol definitions
export interface InspectorMessage {
  method: string;
  params?: any;
  id?: number;
  result?: any;
  error?: any;
}

export interface TestFoundEvent {
  id: number;
  url: string;
  line: number;
  name: string;
  type: "test" | "describe";
  parentId?: number;
}

export interface TestStartEvent {
  id: number;
}

export interface TestEndEvent {
  id: number;
  status: "pass" | "fail" | "timeout" | "skip" | "todo" | "skipped_because_label";
  elapsed: number; // nanoseconds - converted to milliseconds in handler
}

export interface LifecycleErrorEvent {
  message: string;
  name: string;
  urls: string[];
  lineColumns: number[];
  sourceLines: string[];
}

export interface TestError {
  message: string;
  file: string;
  line: number;
  column: number;
}

export const enum FramerState {
  WaitingForLength,
  WaitingForMessage,
}
