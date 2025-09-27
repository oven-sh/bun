import type { SSRManifest } from "bun:app/server";
import type { Readable } from "node:stream";

export interface Manifest {
  moduleMap: SSRManifest;
  moduleLoading?: ModuleLoading;
}

export interface ModuleLoading {
  prefix: string;
  crossOrigin?: string;
}

export interface Options {
  encodeFormAction?: any;
  findSourceMapURL?: any;
  environmentName?: string;
}

export function createFromNodeStream<T = any>(readable: Readable, manifest?: Manifest): Promise<T>;