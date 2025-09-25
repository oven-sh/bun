import type { ServerManifest } from "bun:app/server";
import type { ReactElement } from "react";

export interface PipeableStream<T> {
  /** Returns the input, which should match the Node.js writable interface */
  pipe: <T extends NodeJS.WritableStream>(destination: T) => T;
  abort: () => void;
}

export function renderToPipeableStream<T = any>(
  model: ReactElement,
  webpackMap: ServerManifest,
  options?: RenderToPipeableStreamOptions,
): PipeableStream<T>;

export interface RenderToPipeableStreamOptions {
  onError?: (error: Error) => void;
  identifierPrefix?: string;
  onPostpone?: () => void;
  temporaryReferences?: any;
  environmentName?: string;
  filterStackFrame?: () => boolean;
}
