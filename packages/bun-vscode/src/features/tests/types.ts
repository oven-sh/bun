export interface BunTestResult {
  name: string;
  status: "passed" | "failed" | "skipped";
  message?: string;
  location?: {
    file: string;
    line: number;
    column: number;
  };
  duration?: number;
  children?: BunTestResult[];
  parent?: string;
}

export interface BunFileResult {
  name: string;
  tests: BunTestResult[];
  passed: boolean;
  duration?: number;
}

export type JUnitJson = {
  testsuites: {
    name: string;
    tests: string;
    assertions: string;
    failures: string;
    skipped: string;
    time: string;
    file?: string;
    line?: string;
    children: TestSuite[];
  };
};

type TestSuite = {
  testsuite: {
    name: string;
    tests: string;
    assertions: string;
    failures: string;
    skipped: string;
    time: string;
    hostname: string;
    file?: string;
    line?: string;
    properties?: Array<{
      property: Array<{
        name: string;
        value: string;
      }>;
    }>;
    children: (TestSuite | TestCase)[];
  };
};

type TestCase = {
  testcase: {
    name: string;
    classname: string;
    time: string;
    file?: string;
    line?: string;
    assertions: string;
    children?: (SkippedTest | FailureTest | SystemOut | SystemErr)[];
  };
};

type SkippedTest = {
  skipped: Record<string, never>;
};

type FailureTest = {
  failure: {
    type?: string;
    message?: string;
    content?: string;
  };
};

type SystemOut = {
  "system-out": string;
};

type SystemErr = {
  "system-err": string;
};

export type TestNode = {
  name: string;
  type: "describe" | "test" | "it";
  line: number;
  children: TestNode[];
  parent?: TestNode;
  startIdx: number;
};
