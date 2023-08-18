import { SourceMapConsumer } from "source-map-js";

export type PositionRequest = {
  line?: number;
  column?: number;
  path?: string;
};

export type Position = {
  line: number;
  column: number;
  verified?: boolean;
};

export interface SourceMap {
  generatedPosition(request: PositionRequest): Position;
  originalPosition(request: PositionRequest): Position;
}

class ActualSourceMap implements SourceMap {
  #sourceMap: SourceMapConsumer;
  #sources: string[];

  constructor(sourceMap: SourceMapConsumer) {
    this.#sourceMap = sourceMap;
    // @ts-ignore
    this.#sources = sourceMap._absoluteSources;
  }

  #getSource(path?: string): string {
    const sources = this.#sources;
    if (sources.length === 1) {
      return sources[0];
    }
    if (!path) {
      return sources[0] ?? "";
    }
    for (const source of sources) {
      if (path.endsWith(source)) {
        return source;
      }
    }
    return "";
  }

  generatedPosition(request: PositionRequest): Position {
    const { line, column, path } = request;
    const source = this.#getSource(path);
    const { line: gline, column: gcolumn } = this.#sourceMap.generatedPositionFor({
      line: line ?? 0,
      column: column ?? 0,
      source,
    });
    console.log(`[sourcemap] -->`, { source, path, line, column }, { gline, gcolumn });
    return {
      line: gline || 0,
      column: gcolumn || 0,
      verified: gline >= 0 && gcolumn >= 0,
    };
  }

  originalPosition(request: PositionRequest): Position {
    const { line, column, path } = request;
    const { line: oline, column: ocolumn } = this.#sourceMap.originalPositionFor({
      line: line ?? 0,
      column: column ?? 0,
    });
    console.log(`[sourcemap] <--`, { path, line, column }, { oline, ocolumn });
    return {
      line: oline || 0,
      column: ocolumn || 0,
      verified: oline >= 0 && ocolumn >= 0,
    };
  }
}

class NoopSourceMap implements SourceMap {
  generatedPosition(request: PositionRequest): Position {
    const { line, column } = request;
    return {
      line: line ?? 0,
      column: column ?? 0,
    };
  }

  originalPosition(request: PositionRequest): Position {
    const { line, column } = request;
    return {
      line: line ?? 0,
      column: column ?? 0,
    };
  }
}

const defaultSourceMap = new NoopSourceMap();

export function SourceMap(url?: string): SourceMap {
  if (!url || !url.startsWith("data:")) {
    return defaultSourceMap;
  }
  try {
    const [_, base64] = url.split(",", 2);
    const decoded = Buffer.from(base64, "base64").toString("utf8");
    const sourceMap = new SourceMapConsumer(JSON.parse(decoded));
    return new ActualSourceMap(sourceMap);
  } catch (error) {
    console.warn("Failed to parse source map URL", url);
  }
  return defaultSourceMap;
}
