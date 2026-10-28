export type EditKind = "bareJSONParse" | "consoleLog" | "delete" | "asAny" | "spread" | "try";

export type SourceLanguage = "typescript" | "javascript";

export interface Edit {
  kind: EditKind;
  line(parameter: string, language: SourceLanguage): string | undefined;
}

export const edits: readonly Edit[] = [
  {
    kind: "bareJSONParse",
    line: parameter => `${parameter} = JSON.parse(JSON.stringify(${parameter}));`,
  },
  {
    kind: "consoleLog",
    line: parameter => `console.log(${parameter});`,
  },
  {
    kind: "delete",
    line: (parameter, language) => (language === "typescript" ? `delete (${parameter} as any).oneLineChange;` : `delete ${parameter}.oneLineChange;`),
  },
  {
    kind: "asAny",
    line: (parameter, language) => (language === "typescript" ? `(${parameter} as any).oneLineChange = 1;` : undefined),
  },
  {
    kind: "spread",
    line: (parameter, language) => (language === "typescript" ? `void { ...(${parameter} as object) };` : `void { ...${parameter} };`),
  },
  {
    kind: "try",
    line: parameter => `try { void ${parameter}; } catch {}`,
  },
];

export interface InsertionPoint {
  file: string;
  language: SourceLanguage;
  functionLine: number;
  insertAfterLine: number;
  indentation: string;
  parameter: string;
}

export interface AppliedEdit {
  kind: EditKind;
  point: InsertionPoint;
  text: string;
}

export type EditOutcome =
  | { kind: "withinFunction"; moved: number; allowed: number }
  | { kind: "movedTooFar"; moved: number; allowed: number; movedFunctions: string[] }
  | { kind: "rejectedByBuild"; firstError: string };

export interface EditResult {
  edit: AppliedEdit;
  outcome: EditOutcome;
}
