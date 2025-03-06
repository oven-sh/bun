/// <reference types="node" />

/// <reference path="./s3.d.ts" />
/// <reference path="./fetch.d.ts" />
/// <reference path="./bun.d.ts" />

declare var onmessage: never;

declare module "bun" {
  interface Env {
    [key: string]: string | undefined;
  }

  export var env: Env;

  export var fetch: typeof globalThis.fetch;
}

interface ImportMeta {
  url: string;
  readonly path: string;
  readonly dir: string;
  readonly file: string;
  readonly env: NodeJS.ProcessEnv;
  resolveSync(moduleId: string, parent?: string): string;
  require: NodeJS.Require;
  readonly main: boolean;
  dirname: string;
  filename: string;

  hot?: {
    data: any;
  };
}

interface Headers {
  toJSON(): Record<string, string>;
}

declare namespace NodeJS {
  interface Process {
    readonly version: string;
    browser: boolean;
    isBun: true;
    revision: string;
    reallyExit(code?: number): never;
    dlopen(module: { exports: any }, filename: string, flags?: number): void;
  }

  interface ProcessVersions extends Dict<string> {
    bun: string;
  }
}

declare module "*.svg" {
  const content: `${string}.svg`;
  export = content;
}

declare var FormData: FormData;
